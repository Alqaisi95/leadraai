/**
 * Subscription entitlements and limit enforcement.
 *
 * The shape of the rules, and why they are shaped that way:
 *
 * **A customer's messages are never dropped for billing reasons.** Hitting a
 * limit or letting a trial lapse pauses the *automatic* reply and stops the
 * account from growing (new seats, new Instagram accounts). Inbound messages
 * still arrive, still create conversations, and still reach a human. Losing a
 * real buyer's message because an invoice is late is not a billing control, it
 * is data loss the customer cannot recover from.
 *
 * **A trial that never ends is not a trial.** `trialEndsAt` used to be stored
 * and displayed and read by nothing, so every trial account kept full access
 * forever. Expiry is computed here, on every check, rather than depending on a
 * job having run.
 */
import { prisma } from "./db";
import { createNotification } from "./notify";
import { resolveLimits, type Limits, type MetricKey } from "./plans";

function monthStart(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export type EffectiveStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED" | "NONE";

export type Entitlements = {
  planKey: string;
  /** What the row says. */
  status: string;
  /** What is actually true right now — a lapsed TRIAL reads EXPIRED here. */
  effectiveStatus: EffectiveStatus;
  trialEndsAt: Date | null;
  /** Whole days left in the trial; negative once it has lapsed. */
  trialDaysLeft: number | null;
  currentPeriodEnd: Date | null;
  limits: Required<Limits>;
  /** Automatic replies are permitted by the *subscription* (usage is separate). */
  aiEntitled: boolean;
};

const DAY = 86_400_000;

export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  const limits = resolveLimits(sub?.planKey, sub?.limits);
  const trialEndsAt = sub?.trialEndsAt ?? null;

  let effectiveStatus: EffectiveStatus = (sub?.status as EffectiveStatus) ?? "NONE";
  if (sub?.status === "TRIAL" && trialEndsAt && trialEndsAt.getTime() <= Date.now()) {
    effectiveStatus = "EXPIRED";
  }

  return {
    planKey: sub?.planKey ?? "none",
    status: sub?.status ?? "NONE",
    effectiveStatus,
    trialEndsAt,
    trialDaysLeft: trialEndsAt ? Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY) : null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    limits,
    aiEntitled: effectiveStatus === "TRIAL" || effectiveStatus === "ACTIVE",
  };
}

export type MetricUsage = { used: number; limit: number | null; ratio: number | null; exceeded: boolean };

/** Point-in-time counts plus this calendar month's consumption. */
export async function getUsage(organizationId: string) {
  const since = monthStart();
  const ent = await getEntitlements(organizationId);

  const [users, igAccounts, monthlyConversations, monthlyAiRuns] = await Promise.all([
    prisma.organizationMember.count({
      where: { organizationId, status: { in: ["ACTIVE", "INVITED"] } },
    }),
    prisma.integration.count({ where: { organizationId, status: "CONNECTED" } }),
    prisma.conversation.count({ where: { organizationId, createdAt: { gte: since } } }),
    prisma.aiRun.count({ where: { organizationId, createdAt: { gte: since }, runType: "RESPONSE" } }),
  ]);

  const raw: Record<MetricKey, number> = { users, igAccounts, monthlyConversations, monthlyAiRuns };
  const metrics = {} as Record<MetricKey, MetricUsage>;
  for (const key of Object.keys(raw) as MetricKey[]) {
    const limit = ent.limits[key];
    metrics[key] = {
      used: raw[key],
      limit,
      ratio: limit && limit > 0 ? raw[key] / limit : null,
      exceeded: limit != null && raw[key] >= limit,
    };
  }

  return { periodStart: since, entitlements: ent, metrics };
}

/**
 * Fire a notification at most once per calendar month per (type, title).
 *
 * The previous warning fired on `used === ceil(limit * 0.8)` — an exact
 * equality against a number that is recounted from the database on every call.
 * Two conversations landing between two checks skipped the tripwire entirely
 * and the warning never arrived; conversely, several AI runs while the
 * conversation count sat still fired it repeatedly. Both are fixed by asking
 * the notification table what has already been sent.
 */
async function notifyOncePerMonth(organizationId: string, type: string, title: string, body: string) {
  const existing = await prisma.notification.findFirst({
    where: { organizationId, type: type as any, title, createdAt: { gte: monthStart() } },
    select: { id: true },
  });
  if (existing) return;
  await createNotification({ organizationId, type, title, body });
}

export type AiDecision = { allowed: true } | { allowed: false; reason: string; message: string };

/**
 * Short-lived usage cache for the hot path only.
 *
 * `getUsage` costs five queries, and `aiAllowed` runs it for every single
 * inbound message — so the bill for checking the limits grew with the traffic
 * the limits exist to meter. The counters here are monthly totals in the
 * hundreds or thousands; reading one that is up to a minute stale can overshoot
 * a cap by at most the messages that arrive inside that minute, which is well
 * inside the tolerance of a monthly quota.
 *
 * Deliberately not used by `getUsage` itself: the billing screen states what
 * the customer has consumed, and stale numbers there look like a bug.
 */
const USAGE_TTL_MS = 60_000;
const usageCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof getUsage>> }>();

async function getUsageCached(organizationId: string) {
  const hit = usageCache.get(organizationId);
  if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.value;

  const value = await getUsage(organizationId);
  usageCache.set(organizationId, { at: Date.now(), value });

  // Bound the map on a long-lived worker process; a serverless instance never
  // gets near this.
  if (usageCache.size > 500) {
    const oldest = usageCache.keys().next().value;
    if (oldest) usageCache.delete(oldest);
  }
  return value;
}

/**
 * Called by the orchestrator before generating a reply.
 *
 * Returns a reason the caller can log and a message fit to show a human — the
 * previous version returned a bare `plan_limit_reached` string, and the
 * orchestrator invented its own wording at the call site.
 */
export async function aiAllowed(organizationId: string): Promise<AiDecision> {
  const { entitlements: ent, metrics } = await getUsageCached(organizationId);

  if (!ent.aiEntitled) {
    const expired = ent.effectiveStatus === "EXPIRED";
    await notifyOncePerMonth(
      organizationId,
      "SUBSCRIPTION_EXPIRED",
      expired ? "انتهت الفترة التجريبية" : "الاشتراك غير نشط",
      "الرد الآلي متوقف. المحادثات ما زالت تصل وتُسنَد للموظفين — فعّل الاشتراك لإعادة تشغيل المساعد.",
    );
    return {
      allowed: false,
      reason: expired ? "trial_expired" : `subscription_${ent.effectiveStatus.toLowerCase()}`,
      message: "الرد الآلي متوقف لانتهاء الاشتراك. المحادثة بانتظار موظف.",
    };
  }

  // warn once as each metered dimension crosses 80%
  for (const key of ["monthlyConversations", "monthlyAiRuns"] as const) {
    const m = metrics[key];
    if (m.ratio != null && m.ratio >= 0.8 && !m.exceeded) {
      const label = key === "monthlyConversations" ? "المحادثات" : "ردود المساعد الآلي";
      await notifyOncePerMonth(
        organizationId,
        "PLAN_LIMIT_WARNING",
        `اقتراب حد الباقة: ${label}`,
        `الاستهلاك ${m.used} من ${m.limit} هذا الشهر. رقِّ الباقة قبل بلوغ الحد لتفادي توقف الرد الآلي.`,
      );
    }
  }

  const hit = (["monthlyConversations", "monthlyAiRuns"] as const).find((k) => metrics[k].exceeded);
  if (hit) {
    const label = hit === "monthlyConversations" ? "المحادثات" : "ردود المساعد الآلي";
    await notifyOncePerMonth(
      organizationId,
      "PLAN_LIMIT_REACHED",
      `بلغت حد الباقة: ${label}`,
      `توقف الرد الآلي لبقية الشهر. المحادثات ما زالت تصل وتُسنَد للموظفين — رقِّ الباقة لإعادة تشغيله فورًا.`,
    );
    return {
      allowed: false,
      reason: "plan_limit_reached",
      message: "الرد الآلي متوقف لبلوغ حد الباقة الشهري. المحادثة بانتظار موظف.",
    };
  }

  return { allowed: true };
}

export class PlanLimitError extends Error {
  constructor(
    readonly metric: MetricKey,
    readonly used: number,
    readonly limit: number,
    message: string,
  ) {
    super(message);
  }
}

const METRIC_REFUSAL: Record<MetricKey, string> = {
  users: "بلغت عدد المستخدمين المسموح في باقتك",
  igAccounts: "بلغت عدد حسابات Instagram المسموحة في باقتك",
  monthlyConversations: "بلغت حد المحادثات الشهري",
  monthlyAiRuns: "بلغت حد ردود المساعد الشهري",
};

/**
 * Guard for actions that *grow* the account. Throws rather than returning a
 * boolean so a caller cannot forget to check the result.
 */
export async function assertCanAdd(organizationId: string, metric: MetricKey, adding = 1) {
  const { metrics } = await getUsage(organizationId);
  const m = metrics[metric];
  if (m.limit == null) return;
  if (m.used + adding > m.limit) {
    throw new PlanLimitError(
      metric,
      m.used,
      m.limit,
      `${METRIC_REFUSAL[metric]} (${m.used}/${m.limit}). رقِّ الباقة للمتابعة.`,
    );
  }
}

/**
 * Warn an organisation whose trial is about to lapse. Called by the daily job;
 * safe to call repeatedly — each threshold notifies at most once.
 */
export async function warnExpiringTrials() {
  const soon = new Date(Date.now() + 3 * DAY);
  const subs = await prisma.subscription.findMany({
    where: { status: "TRIAL", trialEndsAt: { not: null, lte: soon } },
    select: { organizationId: true, trialEndsAt: true },
  });

  for (const s of subs) {
    const daysLeft = Math.ceil((s.trialEndsAt!.getTime() - Date.now()) / DAY);
    if (daysLeft > 0) {
      await notifyOncePerMonth(
        s.organizationId,
        "TRIAL_ENDING",
        `تنتهي فترتك التجريبية خلال ${daysLeft} أيام`,
        "اختر باقة قبل الانتهاء ليستمر الرد الآلي بلا انقطاع. بياناتك تبقى كما هي في كل الأحوال.",
      );
    } else {
      await notifyOncePerMonth(
        s.organizationId,
        "SUBSCRIPTION_EXPIRED",
        "انتهت الفترة التجريبية",
        "الرد الآلي متوقف. المحادثات ما زالت تصل وتُسنَد للموظفين — اختر باقة لإعادة تشغيل المساعد.",
      );
    }
  }
  return subs.length;
}
