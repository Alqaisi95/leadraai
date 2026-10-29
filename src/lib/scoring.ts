/**
 * Lead Scoring engine (requirements §4.7).
 * Rules are per-organization (optionally per-project), editable, with full history.
 */
import { prisma } from "./db";

function temperatureFor(score: number): "COLD" | "WARM" | "SALES_READY" {
  if (score >= 70) return "SALES_READY";
  if (score >= 35) return "WARM";
  return "COLD";
}

export async function applyScoringEvent(leadId: string, event: string) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  // project-specific rule wins over org-wide rule
  const rule =
    (lead.interestedProjectId
      ? await prisma.scoringRule.findFirst({
          where: { organizationId: lead.organizationId, projectId: lead.interestedProjectId, event, active: true },
        })
      : null) ??
    (await prisma.scoringRule.findFirst({
      where: { organizationId: lead.organizationId, projectId: null, event, active: true },
    }));
  if (!rule) return null;

  // idempotency: positive one-time events apply once
  const ONE_TIME = ["BUDGET_PROVIDED", "AREA_PROVIDED", "PHONE_SHARED", "NEAR_TERM_PURCHASE"];
  if (ONE_TIME.includes(event)) {
    const already = await prisma.leadScoreEvent.findFirst({ where: { leadId, ruleEvent: event } });
    if (already) return null;
  }
  // recurring negative events: at most once per 24h per lead
  if (event === "NO_REPLY_48H") {
    const recent = await prisma.leadScoreEvent.findFirst({
      where: { leadId, ruleEvent: event, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    if (recent) return null;
  }

  const newScore = Math.max(0, Math.min(100, lead.score + rule.points));

  const [, scoreEvent] = await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { score: newScore, temperature: temperatureFor(newScore) },
    }),
    prisma.leadScoreEvent.create({
      data: { leadId, ruleEvent: event, points: rule.points, reason: rule.label, scoreAfter: newScore },
    }),
  ]);

  // notify on crossing into SALES_READY
  if (lead.score < 70 && newScore >= 70) {
    await prisma.notification.create({
      data: {
        organizationId: lead.organizationId,
        recipientMemberId: lead.ownerMemberId,
        type: "HIGH_SCORE_LEAD",
        title: "عميل جاهز للبيع",
        body: `درجة العميل ${lead.fullName ?? lead.igUsername ?? ""} وصلت ${newScore}`,
        entityType: "lead",
        entityId: leadId,
      },
    });
  }
  return scoreEvent;
}
