/** AI performance (§4.13 تقارير AI). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "reports.read.all");
  const days = Math.min(365, Number(new URL(req.url).searchParams.get("days") ?? 30));
  const since = new Date(Date.now() - days * 86400_000);
  const where = { organizationId: ctx.organizationId, createdAt: { gte: since }, runType: "RESPONSE" as const };

  const [total, handoffs, failures, agg] = await Promise.all([
    prisma.aiRun.count({ where }),
    prisma.aiRun.count({ where: { ...where, handedOff: true } }),
    prisma.aiRun.count({ where: { ...where, error: { not: null } } }),
    prisma.aiRun.aggregate({ where, _avg: { confidence: true, latencyMs: true }, _sum: { costUsd: true } }),
  ]);

  return NextResponse.json({
    periodDays: days,
    totalRuns: total,
    aiHandledRate: total ? Math.round(((total - handoffs) / total) * 100) : 0,
    handoffRate: total ? Math.round((handoffs / total) * 100) : 0,
    failureRate: total ? Math.round((failures / total) * 100) : 0,
    avgConfidence: agg._avg.confidence ? Number(agg._avg.confidence.toFixed(2)) : null,
    avgLatencyMs: agg._avg.latencyMs ? Math.round(agg._avg.latencyMs) : null,
    totalCostUsd: agg._sum.costUsd ?? 0,
  });
});
