/** Management dashboard KPIs (§4.13 تقارير الإدارة). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "reports.read.all");
  const url = new URL(req.url);
  const days = Math.min(365, Number(url.searchParams.get("days") ?? 30));
  const since = new Date(Date.now() - days * 86400_000);
  const orgId = ctx.organizationId;

  const [newConversations, newLeads, qualifiedLeads, salesReady, wonOpps, pipelineValue, availableUnits, soldUnits, bySource] =
    await Promise.all([
      prisma.conversation.count({ where: { organizationId: orgId, createdAt: { gte: since } } }),
      prisma.lead.count({ where: { organizationId: orgId, createdAt: { gte: since }, mergedIntoLeadId: null } }),
      prisma.lead.count({ where: { organizationId: orgId, createdAt: { gte: since }, temperature: { in: ["WARM", "SALES_READY"] }, mergedIntoLeadId: null } }),
      prisma.lead.count({ where: { organizationId: orgId, temperature: "SALES_READY", mergedIntoLeadId: null } }),
      prisma.opportunity.count({ where: { organizationId: orgId, stage: { isWon: true }, updatedAt: { gte: since } } }),
      prisma.opportunity.aggregate({ where: { organizationId: orgId, archivedAt: null, stage: { isWon: false, isLost: false } }, _sum: { value: true } }),
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
    newConversations,
    newLeads,
    qualifiedLeads,
    conversionRate: newLeads > 0 ? Math.round((qualifiedLeads / newLeads) * 100) : 0,
    salesReady,
    wonDeals: wonOpps,
    pipelineValue: pipelineValue._sum.value ?? 0,
    inventory: { available: availableUnits, sold: soldUnits },
    sources,
  });
});
