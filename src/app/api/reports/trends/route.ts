/** Daily conversations/leads series + pipeline funnel for dashboard charts. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "reports.read.all");
  const url = new URL(req.url);
  const days = Math.min(90, Number(url.searchParams.get("days") ?? 30));
  const since = new Date(Date.now() - days * 86400_000);
  const orgId = ctx.organizationId;

  const [convs, leads, pipeline] = await Promise.all([
    prisma.conversation.findMany({
      where: { organizationId: orgId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.lead.findMany({
      where: { organizationId: orgId, createdAt: { gte: since }, mergedIntoLeadId: null },
      select: { createdAt: true },
    }),
    prisma.pipeline.findFirst({
      where: { organizationId: orgId, isDefault: true },
      include: {
        stages: {
          orderBy: { order: "asc" },
          select: {
            name: true,
            isWon: true,
            isLost: true,
            _count: { select: { opportunities: { where: { archivedAt: null } } } },
          },
        },
      },
    }),
  ]);

  const byDay = new Map<string, { conversations: number; leads: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000);
    byDay.set(d.toISOString().slice(0, 10), { conversations: 0, leads: 0 });
  }
  for (const c of convs) {
    const k = c.createdAt.toISOString().slice(0, 10);
    const row = byDay.get(k);
    if (row) row.conversations++;
  }
  for (const l of leads) {
    const k = l.createdAt.toISOString().slice(0, 10);
    const row = byDay.get(k);
    if (row) row.leads++;
  }

  return NextResponse.json({
    daily: Array.from(byDay.entries()).map(([date, v]) => ({ date, ...v })),
    funnel: (pipeline?.stages ?? []).map((s) => ({
      stage: s.name,
      count: s._count.opportunities,
      isWon: s.isWon,
      isLost: s.isLost,
    })),
  });
});
