/** PATCH /api/scoring-rules/:id — points, label, on/off. Existing lead scores are not recalculated. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

const schema = z.object({
  points: z.number().int().min(-100).max(100).optional(),
  label: z.string().trim().min(2).max(120).optional(),
  active: z.boolean().optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "scoring.rules.manage");
  const id = new URL(req.url).pathname.split("/").at(-1)!;
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);

  const rule = await prisma.scoringRule.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!rule) throw new TenantMismatchError();
  const updated = await prisma.scoringRule.update({ where: { id }, data: body.data });
  await audit({ ctx, action: "scoring_rule.update", entityType: "scoring_rule", entityId: id, before: rule, after: updated, correlationId });
  return NextResponse.json(updated);
});
