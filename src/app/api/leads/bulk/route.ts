/**
 * Bulk actions on selected leads.
 *
 * Reassigning or re-staging one lead at a time is the single most repetitive
 * thing a manager does after an import or when someone leaves the team.
 *
 * Every action is scoped and validated *before* anything is written, and the
 * write itself is a single updateMany — a bulk edit that half-applied would
 * leave the manager with no way to tell which rows moved.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { applyScoringEvent } from "@/lib/scoring";

const MAX_IDS = 200;

const schema = z.object({
  leadIds: z.array(z.string()).min(1).max(MAX_IDS),
  action: z.enum(["assign", "stage", "temperature"]),
  /** assign: member id, or null to return the leads to the pool */
  assignedMemberId: z.string().nullish(),
  /** stage: target pipeline stage */
  stageId: z.string().optional(),
  lostReason: z.string().max(500).optional(),
  temperature: z.enum(["COLD", "WARM", "SALES_READY"]).optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "leads.update");

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return err(422, "VALIDATION", `حدد العملاء والإجراء (بحد أقصى ${MAX_IDS} عميلًا)`, correlationId);
  }
  const { leadIds, action } = body.data;

  // only operate on leads this caller can actually see
  const leads = await prisma.lead.findMany({
    where: {
      id: { in: leadIds },
      organizationId: ctx.organizationId,
      mergedIntoLeadId: null,
      ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}),
    },
    select: { id: true, ownerMemberId: true, phone: true },
  });
  if (leads.length === 0) return err(404, "NOT_FOUND", "لا عملاء مطابقون ضمن صلاحيتك", correlationId);

  const skipped = leadIds.length - leads.length;
  const ids = leads.map((l) => l.id);

  if (action === "assign") {
    const target = body.data.assignedMemberId ?? null;
    if (target !== ctx.memberId) requirePermission(ctx.role, "leads.assign");
    if (target) {
      const member = await prisma.organizationMember.findFirst({
        where: { id: target, organizationId: ctx.organizationId, status: "ACTIVE" },
      });
      if (!member) return err(422, "VALIDATION", "الموظف غير موجود أو غير نشط", correlationId);
    }

    await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { ownerMemberId: target } });
    await audit({
      ctx,
      action: "lead.bulk_assign",
      entityType: "lead",
      after: { count: ids.length, assignedMemberId: target },
      correlationId,
    });
    return NextResponse.json({ updated: ids.length, skipped });
  }

  if (action === "temperature") {
    if (!body.data.temperature) return err(422, "VALIDATION", "التصنيف مطلوب", correlationId);
    await prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { temperature: body.data.temperature },
    });
    await audit({
      ctx,
      action: "lead.bulk_temperature",
      entityType: "lead",
      after: { count: ids.length, temperature: body.data.temperature },
      correlationId,
    });
    return NextResponse.json({ updated: ids.length, skipped });
  }

  // action === "stage"
  requirePermission(ctx.role, "opportunities.move");
  if (!body.data.stageId) return err(422, "VALIDATION", "المرحلة مطلوبة", correlationId);

  const stage = await prisma.pipelineStage.findFirst({
    where: { id: body.data.stageId, pipeline: { organizationId: ctx.organizationId } },
  });
  if (!stage) return err(422, "VALIDATION", "المرحلة غير موجودة", correlationId);
  if (stage.isLost && !body.data.lostReason) {
    return err(422, "VALIDATION", "سبب الخسارة مطلوب عند النقل إلى مرحلة الفقدان", correlationId);
  }

  // entry rules are enforced per lead, exactly as a single move would —
  // a bulk action must not become a way around them
  const required = (stage.entryRules as { requires?: string[] } | null)?.requires ?? [];
  const eligible = leads.filter((l) => required.every((f) => Boolean((l as any)[f])));
  const blocked = leads.length - eligible.length;
  if (eligible.length === 0) {
    return err(
      409,
      "ENTRY_RULE",
      `لا يمكن نقل أي منهم إلى "${stage.name}" — ينقص: ${required.join("، ")}`,
      correlationId,
    );
  }

  const opps = await prisma.opportunity.findMany({
    where: {
      organizationId: ctx.organizationId,
      archivedAt: null,
      leadId: { in: eligible.map((l) => l.id) },
    },
    select: { id: true, leadId: true, stage: { select: { name: true } } },
  });

  await prisma.opportunity.updateMany({
    where: { id: { in: opps.map((o) => o.id) } },
    data: {
      stageId: stage.id,
      enteredStageAt: new Date(),
      ...(body.data.lostReason ? { lostReason: body.data.lostReason } : {}),
    },
  });

  // same scoring side-effect a single move produces — otherwise a bulk move to
  // the visit stage would silently leave scores (and the sales-ready board) stale
  if (stage.name.includes("زيارة")) {
    for (const o of opps) {
      if (!o.stage.name.includes("زيارة")) await applyScoringEvent(o.leadId, "VISIT_REQUESTED");
    }
  }

  await audit({
    ctx,
    action: "lead.bulk_stage",
    entityType: "opportunity",
    after: { count: opps.length, stage: stage.name, blocked },
    correlationId,
  });

  return NextResponse.json({ updated: opps.length, skipped, blocked });
});
