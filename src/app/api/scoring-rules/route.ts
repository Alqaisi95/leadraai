/** GET /api/scoring-rules — the organization's lead-scoring rules (org-wide and per project). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "scoring.rules.manage");
  const items = await prisma.scoringRule.findMany({
    where: scoped(ctx),
    orderBy: [{ projectId: "asc" }, { points: "desc" }],
    include: { project: { select: { name: true } } },
  });
  return NextResponse.json({ items });
});
