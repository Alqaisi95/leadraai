/**
 * Merge a duplicate lead into this one (§4.6 — always manual, never automatic).
 * The loser keeps its row and points at the winner via mergedIntoLeadId, so the
 * history stays auditable and nothing is destroyed.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

const schema = z.object({ duplicateLeadId: z.string() });

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "leads.update");
  const targetId = req.nextUrl.pathname.split("/").at(-2)!;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(422, "VALIDATION", "duplicateLeadId مطلوب", correlationId);
  const { duplicateLeadId } = parsed.data;
  if (duplicateLeadId === targetId)
    return err(422, "VALIDATION", "لا يمكن دمج العميل مع نفسه", correlationId);

  const [target, duplicate] = await Promise.all([
    prisma.lead.findFirst({
      where: { id: targetId, organizationId: ctx.organizationId, mergedIntoLeadId: null },
    }),
    prisma.lead.findFirst({
      where: { id: duplicateLeadId, organizationId: ctx.organizationId, mergedIntoLeadId: null },
    }),
  ]);
  if (!target || !duplicate) throw new TenantMismatchError();

  // fill blanks on the survivor from the duplicate — never overwrite known data
  const fill: Record<string, unknown> = {};
  for (const key of [
    "fullName",
    "phone",
    "email",
    "city",
    "area",
    "propertyType",
    "paymentMethod",
    "buyTimeframe",
    "igUsername",
  ] as const) {
    if (!target[key] && duplicate[key]) fill[key] = duplicate[key];
  }
  if (!target.budgetMin && duplicate.budgetMin) fill.budgetMin = duplicate.budgetMin;
  if (!target.budgetMax && duplicate.budgetMax) fill.budgetMax = duplicate.budgetMax;
  if (target.purpose === "UNKNOWN" && duplicate.purpose !== "UNKNOWN") fill.purpose = duplicate.purpose;
  if (!target.interestedProjectId && duplicate.interestedProjectId)
    fill.interestedProjectId = duplicate.interestedProjectId;
  // the merged record inherits the higher score — it represents the same person
  if (duplicate.score > target.score) {
    fill.score = duplicate.score;
    fill.temperature = duplicate.temperature;
  }

  await prisma.$transaction([
    prisma.lead.update({ where: { id: target.id }, data: { ...fill, lastInteractionAt: new Date() } }),
    prisma.note.updateMany({ where: { leadId: duplicate.id }, data: { leadId: target.id } }),
    prisma.task.updateMany({ where: { leadId: duplicate.id }, data: { leadId: target.id } }),
    prisma.appointment.updateMany({ where: { leadId: duplicate.id }, data: { leadId: target.id } }),
    prisma.leadIdentifier.updateMany({ where: { leadId: duplicate.id }, data: { leadId: target.id } }),
    // the duplicate's board card is archived rather than moved, to avoid two
    // cards for one person sitting in different stages
    prisma.opportunity.updateMany({
      where: { leadId: duplicate.id, archivedAt: null },
      data: { archivedAt: new Date() },
    }),
    prisma.lead.update({ where: { id: duplicate.id }, data: { mergedIntoLeadId: target.id } }),
  ]);

  await audit({
    ctx,
    action: "lead.merge",
    entityType: "lead",
    entityId: target.id,
    before: { duplicateId: duplicate.id, duplicateName: duplicate.fullName },
    after: { mergedInto: target.id, filled: Object.keys(fill) },
    correlationId,
  });

  return NextResponse.json({ ok: true, filled: Object.keys(fill) });
});
