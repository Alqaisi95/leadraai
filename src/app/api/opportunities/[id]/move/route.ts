/**
 * Move opportunity between stages with mandatory entry rules (§4.8).
 * AGENT role: server checks allowed range; managers can move anywhere.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { applyScoringEvent } from "@/lib/scoring";

const schema = z.object({ stageId: z.string(), lostReason: z.string().max(500).optional(), value: z.number().nonnegative().optional() });

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "opportunities.move");
  const id = req.nextUrl.pathname.split("/").at(-2)!;

  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "stageId required", correlationId);

  const opp = await prisma.opportunity.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { lead: true, stage: true },
  });
  if (!opp) throw new TenantMismatchError();

  // agents may only move their own leads
  if (!hasPermission(ctx.role, "opportunities.move.any") && opp.lead.ownerMemberId !== ctx.memberId) {
    return err(403, "FORBIDDEN", "You can only move your own leads", correlationId);
  }

  const target = await prisma.pipelineStage.findFirst({
    where: { id: body.data.stageId, pipeline: { organizationId: ctx.organizationId } },
  });
  if (!target) throw new TenantMismatchError();

  // mandatory entry rules
  const rules = (target.entryRules as { requires?: string[] } | null)?.requires ?? [];
  for (const field of rules) {
    if (!(opp.lead as any)[field]) {
      return err(409, "ENTRY_RULE", `لا يمكن النقل إلى "${target.name}" قبل استكمال: ${field}`, correlationId);
    }
  }
  if (target.isLost && !body.data.lostReason) {
    return err(409, "ENTRY_RULE", "سبب الخسارة مطلوب عند نقل الفرصة إلى مرحلة الفقدان", correlationId);
  }

  const updated = await prisma.opportunity.update({
    where: { id: opp.id },
    data: {
      stageId: target.id,
      enteredStageAt: new Date(),
      ...(body.data.lostReason ? { lostReason: body.data.lostReason } : {}),
      ...(body.data.value !== undefined ? { value: body.data.value } : {}),
    },
  });

  if (target.name.includes("زيارة") && !opp.stage.name.includes("زيارة")) {
    await applyScoringEvent(opp.leadId, "VISIT_REQUESTED");
  }

  await audit({ ctx, action: "opportunity.move", entityType: "opportunity", entityId: opp.id, before: { stage: opp.stage.name }, after: { stage: target.name }, correlationId });
  return NextResponse.json(updated);
});
