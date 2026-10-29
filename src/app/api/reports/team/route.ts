/** R2.6 — team performance via aggregate SQL (no per-agent loops). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

const SLA_FIRST_RESPONSE_MIN = 15;

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "reports.read.team");
  const days = Math.min(365, Number(new URL(req.url).searchParams.get("days") ?? 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const orgId = ctx.organizationId;

  const [agents, leadCounts, staleCounts, wonCounts, apptCounts, firstResponses] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId: orgId, role: { in: ["AGENT", "SALES_MANAGER"] }, status: "ACTIVE" },
      include: { user: { select: { fullName: true } } },
    }),
    prisma.lead.groupBy({
      by: ["ownerMemberId"],
      where: { organizationId: orgId, mergedIntoLeadId: null, ownerMemberId: { not: null } },
      _count: true,
    }),
    prisma.lead.groupBy({
      by: ["ownerMemberId"],
      where: {
        organizationId: orgId, mergedIntoLeadId: null, ownerMemberId: { not: null },
        lastInteractionAt: { lt: new Date(Date.now() - 3 * 86_400_000) },
      },
      _count: true,
    }),
    prisma.$queryRaw<{ member_id: string; won: bigint }[]>`
      SELECT l."ownerMemberId" AS member_id, COUNT(*)::bigint AS won
      FROM opportunities o
      JOIN leads l ON l.id = o."leadId"
      JOIN pipeline_stages ps ON ps.id = o."stageId"
      WHERE o."organizationId" = ${orgId} AND ps."isWon" = true AND o."updatedAt" >= ${since}
        AND l."ownerMemberId" IS NOT NULL
      GROUP BY 1`,
    prisma.appointment.groupBy({
      by: ["memberId"],
      where: { organizationId: orgId, startsAt: { gte: since }, status: { in: ["COMPLETED", "CONFIRMED", "SCHEDULED"] } },
      _count: true,
    }),
    // first agent reply per conversation vs conversation start — one query
    prisma.$queryRaw<{ member_id: string; avg_min: number; breaches: bigint; total: bigint }[]>`
      WITH firsts AS (
        SELECT m."senderMemberId" AS member_id,
               MIN(m."createdAt") AS first_reply,
               c."createdAt" AS conv_start
        FROM messages m
        JOIN conversations c ON c.id = m."conversationId"
        WHERE m."organizationId" = ${orgId} AND m."senderMemberId" IS NOT NULL
          AND m."createdAt" >= ${since}
        GROUP BY m."senderMemberId", m."conversationId", c."createdAt"
      ),
      diffs AS (
        SELECT member_id, EXTRACT(EPOCH FROM (first_reply - conv_start)) / 60 AS min
        FROM firsts
        WHERE first_reply >= conv_start AND first_reply < conv_start + interval '24 hours'
      )
      SELECT member_id,
             AVG(min)::float AS avg_min,
             COUNT(*) FILTER (WHERE min > ${SLA_FIRST_RESPONSE_MIN})::bigint AS breaches,
             COUNT(*)::bigint AS total
      FROM diffs GROUP BY member_id`,
  ]);

  const by = <T extends { [k: string]: any }>(arr: T[], key: string) =>
    Object.fromEntries(arr.map((r) => [r[key], r]));
  const leadsBy = by(leadCounts as any[], "ownerMemberId");
  const staleBy = by(staleCounts as any[], "ownerMemberId");
  const wonBy = by(wonCounts as any[], "member_id");
  const apptBy = by(apptCounts as any[], "memberId");
  const frBy = by(firstResponses as any[], "member_id");

  const rows = agents.map((a) => ({
    member: a.user.fullName,
    role: a.role,
    leads: leadsBy[a.id]?._count ?? 0,
    wonDeals: Number(wonBy[a.id]?.won ?? 0),
    appointments: apptBy[a.id]?._count ?? 0,
    avgFirstResponseMin: frBy[a.id] ? Math.round(frBy[a.id].avg_min) : null,
    slaBreaches: Number(frBy[a.id]?.breaches ?? 0),
    staleLeads: staleBy[a.id]?._count ?? 0,
  }));

  return NextResponse.json({ periodDays: days, slaMinutes: SLA_FIRST_RESPONSE_MIN, rows });
});
