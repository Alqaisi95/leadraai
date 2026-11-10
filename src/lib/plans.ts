/**
 * The plan catalogue — the single source of truth for what each package costs
 * and grants.
 *
 * Two rules govern everything here:
 *
 * 1. **Only advertise a limit we actually measure.** The previous catalogue
 *    promised an `aiTokens` budget and a `storageMb` cap that no code path ever
 *    counted, so both were decoration: a customer could exceed either without
 *    anything noticing. Every metric below is counted by `lib/billing.ts`.
 *
 * 2. **The subscription row owns the effective limits, not this file.** Limits
 *    are copied onto the row when a plan is chosen, so an existing customer
 *    keeps what they bought even if the catalogue changes underneath them, and
 *    an enterprise deal can carry limits no public plan offers. This file is
 *    what a *change* reads from, and the fallback for keys a row predates.
 */

export type MetricKey = "users" | "igAccounts" | "monthlyConversations" | "monthlyAiRuns";

/** null = unmetered. Absent = fall back to the catalogue default. */
export type Limits = Partial<Record<MetricKey, number | null>>;

export type Plan = {
  key: string;
  name: string;
  tagline: string;
  /** Monthly price. `null` on plans that are not self-serve. */
  priceMonthly: number | null;
  currency: "USD";
  limits: Required<Limits>;
  features: string[];
  /** Hidden from the public picker — reachable only by an existing assignment. */
  internal?: boolean;
};

export const METRICS: { key: MetricKey; label: string; unit: string; perPeriod: boolean }[] = [
  { key: "users", label: "المستخدمون", unit: "مستخدم", perPeriod: false },
  { key: "igAccounts", label: "حسابات Instagram", unit: "حساب", perPeriod: false },
  { key: "monthlyConversations", label: "المحادثات", unit: "محادثة", perPeriod: true },
  { key: "monthlyAiRuns", label: "ردود المساعد الآلي", unit: "رد", perPeriod: true },
];

export const PLANS: Plan[] = [
  {
    key: "trial",
    name: "تجربة",
    tagline: "١٤ يومًا لتجربة المنصة كاملة بلا التزام.",
    priceMonthly: 0,
    currency: "USD",
    limits: { users: 5, igAccounts: 1, monthlyConversations: 500, monthlyAiRuns: 500 },
    features: ["كل الميزات مفتوحة", "تنتهي تلقائيًا بعد ١٤ يومًا", "بلا بطاقة دفع"],
    internal: true,
  },
  {
    key: "starter",
    name: "البداية",
    tagline: "مكتب صغير أو فريق مبيعات من ثلاثة إلى خمسة.",
    priceMonthly: 49,
    currency: "USD",
    limits: { users: 5, igAccounts: 1, monthlyConversations: 1_000, monthlyAiRuns: 1_000 },
    features: ["حساب Instagram واحد", "ردود آلية وتنقيط تلقائي", "تقارير الأداء الأساسية"],
  },
  {
    key: "growth",
    name: "النمو",
    tagline: "شركة عقارية بفريق مبيعات كامل وأكثر من حساب.",
    priceMonthly: 149,
    currency: "USD",
    limits: { users: 15, igAccounts: 3, monthlyConversations: 5_000, monthlyAiRuns: 5_000 },
    features: ["٣ حسابات Instagram", "توزيع تلقائي على الفريق", "قواعد تنقيط مخصّصة", "سجل تدقيق كامل"],
  },
  {
    key: "scale",
    name: "التوسّع",
    tagline: "أكثر من مشروع وفرق متعددة بحجم مراسلات كبير.",
    priceMonthly: 399,
    currency: "USD",
    limits: { users: 50, igAccounts: 10, monthlyConversations: 25_000, monthlyAiRuns: 25_000 },
    features: ["١٠ حسابات Instagram", "فرق ومناطق متعددة", "أولوية في المعالجة", "دعم مخصّص"],
  },
  {
    key: "enterprise",
    name: "مؤسسي",
    tagline: "حدود مفصّلة على القياس، بعقد ودعم مخصّصين.",
    priceMonthly: null,
    currency: "USD",
    limits: { users: 200, igAccounts: 50, monthlyConversations: 100_000, monthlyAiRuns: 100_000 },
    features: ["حدود على القياس", "اتفاقية مستوى خدمة", "مدير حساب"],
    internal: true,
  },
];

const BY_KEY = new Map(PLANS.map((p) => [p.key, p]));

export function getPlan(key: string | null | undefined): Plan | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

/** Plans a customer may move to on their own. */
export function selfServePlans(): Plan[] {
  return PLANS.filter((p) => !p.internal);
}

/**
 * The limits actually in force for a subscription row.
 *
 * The row wins, key by key — that is what makes a grandfathered or negotiated
 * limit survive a catalogue change. A key the row predates falls back to the
 * plan, and an unrecognised plan falls back to the most restrictive public
 * package rather than to "unlimited": failing open on billing would let an
 * unknown plan key hand out the whole product.
 */
export function resolveLimits(planKey: string | null | undefined, stored: unknown): Required<Limits> {
  const plan = getPlan(planKey) ?? getPlan("starter")!;
  const row = (stored ?? {}) as Record<string, unknown>;
  const out = { ...plan.limits };

  for (const { key } of METRICS) {
    const v = row[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
    else if (v === null) out[key] = null; // explicit unmetered
  }
  return out;
}

/** Is `to` smaller than `from` on any metric? Used to guard downgrades. */
export function tighterMetrics(from: Required<Limits>, to: Required<Limits>): MetricKey[] {
  return METRICS.map((m) => m.key).filter((k) => {
    const a = from[k];
    const b = to[k];
    if (b === null) return false; // moving to unmetered is never tighter
    if (a === null) return true; // leaving unmetered always is
    return b < a;
  });
}
