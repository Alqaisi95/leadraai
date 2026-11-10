/** Management dashboard KPIs (§4.13 تقارير الإدارة). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

/**
 * Counts for one window. Called twice — current and the immediately preceding
 * window of equal length — so a number can be read as a trend rather than a
 * bare figure the operator has no baseline for.
 *
 * Point-in-time figures (sales-ready leads, pipeline value, inventory) are
 * deliberately excluded: they describe *now*, not a period, so comparing them
 * across windows would be meaningless.
 */
async function windowCounts(orgId: string, from: Date, to: Date) {
  const created = { gte: from, lt: to };
  const [newConversations, newLeads, qualifiedLeads, wonDeals] = await Promise.all([
    prisma.conversation.count({ where: { organizationId: orgId, createdAt: created } }),
    prisma.lead.count({ where: { organizationId: orgId, createdAt: created, mergedIntoLeadId: null } }),
    prisma.lead.count({
      where: {
        organizationId: orgId,
        createdAt: created,
        temperature: { in: ["WARM", "SALES_READY"] },
        mergedIntoLeadId: null,
      },
    }),
    prisma.opportunity.count({
      where: { organizationId: orgId, stage: { isWon: true }, updatedAt: created },
    }),
  ]);

  return {
    newConversations,
    newLeads,
    qualifiedLeads,
    wonDeals,
    conversionRate: newLeads > 0 ? Math.round((qualifiedLeads / newLeads) * 100) : 0,
  };
}

/** Percentage change, or null when there is no baseline to divide by. */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "reports.read.all");
  const url = new URL(req.url);
  const days = Math.min(365, Number(url.searchParams.get("days") ?? 30));
  const orgId = ctx.organizationId;

  const now = new Date();
  const since = new Date(now.getTime() - days * 86400_000);
  const prevSince = new Date(since.getTime() - days * 86400_000);

  const [current, previous, salesReady, pipelineValue, availableUnits, soldUnits, bySource] =
    await Promise.all([
      windowCounts(orgId, since, now),
      windowCounts(orgId, prevSince, since),
      prisma.lead.count({
        where: { organizationId: orgId, temperature: "SALES_READY", mergedIntoLeadId: null },
      }),
      prisma.opportunity.aggregate({
        where: { organizationId: orgId, archivedAt: null, stage: { isWon: false, isLost: false } },
        _sum: { value: true },
      }),
      prisma.unit.count({ where: { organizationId: orgId, status: "AVAILABLE" } }),
      prisma.unit.count({ where: { organizationId: orgId, status: "SOLD" } }),
      prisma.lead.groupBy({
        by: ["campaignId"],
        where: { organizationId: orgId, createdAt: { gte: since }, mergedIntoLeadId: null },
        _count: true,
      }),
    ]);

  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: bySource.map((s) => s.campaignId).filter(Boolean) as string[] } },
    select: { id: true, name: true, cost: true },
  });
  const sources = bySource.map((s) => {
    const c = campaigns.find((x) => x.id === s.campaignId);
    const cost = c?.cost ? Number(c.cost) : null;
    return {
      campaign: c?.name ?? "Organic / غير محدد",
      leads: s._count,
      costPerLead: cost && s._count > 0 ? Math.round(cost / s._count) : null,
    };
  });

  return NextResponse.json({
    periodDays: days,
    ...current,
    salesReady,
    pipelineValue: pipelineValue._sum.value ?? 0,
    inventory: { available: availableUnits, sold: soldUnits },
    sources,
    previous,
    deltas: {
      newConversations: delta(current.newConversations, previous.newConversations),
      newLeads: delta(current.newLeads, previous.newLeads),
      qualifiedLeads: delta(current.qualifiedLeads, previous.qualifiedLeads),
      wonDeals: delta(current.wonDeals, previous.wonDeals),
      // a rate is already normalised — report the point difference, not a
      // percentage of a percentage
      conversionRate: current.conversionRate - previous.conversionRate,
    },
  });
});
