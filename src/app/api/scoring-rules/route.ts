/** Lead scoring rules — read for everyone who can see leads, edit for admins. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const items = await prisma.scoringRule.findMany({
    where: scoped(ctx),
    orderBy: { points: "desc" },
  });
  return NextResponse.json({ items });
});

const patchSchema = z.object({
  ruleId: z.string(),
  points: z.number().int().min(-100).max(100).optional(),
  active: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "scoring.rules.manage");
  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "ruleId and points/active required", correlationId);

  const rule = await prisma.scoringRule.findFirst({
    where: { id: body.data.ruleId, organizationId: ctx.organizationId },
  });
  if (!rule) return err(404, "NOT_FOUND", "Rule not found", correlationId);

  const updated = await prisma.scoringRule.update({
    where: { id: rule.id },
    data: {
      ...(body.data.points !== undefined ? { points: body.data.points } : {}),
      ...(body.data.active !== undefined ? { active: body.data.active } : {}),
    },
  });
  await audit({
    ctx,
    action: "scoring_rule.update",
    entityType: "scoring_rule",
    entityId: rule.id,
    before: { points: rule.points, active: rule.active },
    after: { points: updated.points, active: updated.active },
    correlationId,
  });
  return NextResponse.json(updated);
});
