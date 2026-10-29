/**
 * R2.2 — subscription limits enforcement.
 * Metrics: monthlyConversations, aiTokens (approx by runs*avg), users, igAccounts.
 * 80% → warn once; 100% → AI paused (messages still flow to humans).
 */
import { prisma } from "./db";
import { createNotification } from "./notify";

function monthStart(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function getUsage(organizationId: string) {
  const since = monthStart();
  const [conversations, aiRuns, sub] = await Promise.all([
    prisma.conversation.count({ where: { organizationId, createdAt: { gte: since } } }),
    prisma.aiRun.count({ where: { organizationId, createdAt: { gte: since }, runType: "RESPONSE" } }),
    prisma.subscription.findUnique({ where: { organizationId } }),
  ]);
  const limits = (sub?.limits as any) ?? {};
  return {
    plan: sub?.planKey ?? "none",
    status: sub?.status ?? "TRIAL",
    conversations: { used: conversations, limit: limits.monthlyConversations ?? null },
    aiRuns: { used: aiRuns, limit: limits.monthlyAiRuns ?? limits.monthlyConversations ?? null },
  };
}

/** Called by the orchestrator before generating. Returns whether AI may run. */
export async function aiAllowed(organizationId: string): Promise<{ allowed: boolean; reason?: string }> {
  const u = await getUsage(organizationId);
  const check = (used: number, limit: number | null) => (limit == null ? 1e9 : limit) - used;

  const convRemaining = check(u.conversations.used, u.conversations.limit);
  const aiRemaining = check(u.aiRuns.used, u.aiRuns.limit);

  // one-time 80% warning per month
  for (const [metric, m] of [["المحادثات", u.conversations], ["استدعاءات AI", u.aiRuns]] as const) {
    if (m.limit && m.used === Math.ceil(m.limit * 0.8)) {
      await createNotification({
        organizationId, type: "SLA_WARNING",
        title: `اقتراب حد الباقة: ${metric}`,
        body: `الاستهلاك ${m.used} من ${m.limit} هذا الشهر`,
      });
    }
  }

  if (aiRemaining <= 0 || convRemaining <= 0) {
    return { allowed: false, reason: "plan_limit_reached" };
  }
  return { allowed: true };
}
