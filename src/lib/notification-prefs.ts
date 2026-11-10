/**
 * Per-member notification preferences.
 *
 * Three channels, decided independently:
 *   inApp — whether the notification appears in this member's bell/feed
 *   email — whether it also lands in their inbox
 *   push  — whether it reaches their phone while the app is closed
 *
 * Stored as a partial map on the member row, not a full one: anything absent
 * falls back to the default below. That keeps old rows (and members who never
 * opened the settings page) working exactly as before, and means changing a
 * default later actually reaches everyone who never overrode it.
 *
 * Some types cannot be silenced in-app. A member who mutes SLA breaches or
 * unauthorized-access alerts is muting the only signal that something is wrong;
 * the email channel is theirs to turn off, the record is not.
 */

export type Channel = "inApp" | "email" | "push";
export type PrefMap = Record<string, { inApp: boolean; email: boolean; push: boolean }>;

type TypeDef = {
  type: string;
  label: string;
  hint: string;
  /** delivered by email unless the member opts out */
  email: boolean;
  /**
   * Pushed to registered devices unless the member opts out.
   *
   * Deliberately narrower than email by default. A push interrupts someone
   * wherever they are; the ones that earn that are the ones that decay if
   * nobody acts — a lead going cold, an SLA about to breach, a conversation
   * waiting on a person. Billing and system notices can wait for the bell.
   */
  push: boolean;
  /** false = the in-app toggle is fixed on */
  canMuteInApp: boolean;
  /** grouping in the settings UI */
  group: "leads" | "service" | "system" | "billing";
};

export const NOTIFICATION_TYPES: TypeDef[] = [
  {
    type: "HIGH_SCORE_LEAD",
    label: "عميل جاهز للبيع",
    hint: "عندما تتجاوز درجة عميل حد الجاهزية.",
    push: true,
    email: true,
    canMuteInApp: true,
    group: "leads",
  },
  {
    type: "HUMAN_REQUESTED",
    label: "طلب تدخل بشري",
    hint: "المحادثة تجاوزت قدرة المساعد الآلي وتنتظر ردًا.",
    push: true,
    email: false,
    canMuteInApp: true,
    group: "service",
  },
  {
    type: "COMPLAINT",
    label: "شكوى",
    hint: "رصد المساعد نبرة شكوى في محادثة.",
    push: true,
    email: true,
    canMuteInApp: true,
    group: "service",
  },
  {
    type: "SLA_WARNING",
    label: "اقتراب مهلة الرد",
    hint: "محادثة قاربت على تجاوز مهلة الرد الأول.",
    push: true,
    email: false,
    canMuteInApp: true,
    group: "service",
  },
  {
    type: "SLA_BREACH",
    label: "تجاوز مهلة الرد",
    hint: "محادثة تجاوزت مهلة الرد الأول فعليًا.",
    push: true,
    email: true,
    canMuteInApp: false,
    group: "service",
  },
  {
    type: "APPOINTMENT_SOON",
    label: "موعد قريب",
    hint: "تذكير قبل موعد الزيارة.",
    push: true,
    email: false,
    canMuteInApp: true,
    group: "leads",
  },
  {
    type: "TASK_OVERDUE",
    label: "مهمة متأخرة",
    hint: "مهمة تجاوزت تاريخ استحقاقها.",
    push: false,
    email: false,
    canMuteInApp: true,
    group: "leads",
  },
  {
    type: "TOKEN_EXPIRING",
    label: "انتهاء صلاحية ربط Meta",
    hint: "رمز الوصول لحساب Instagram على وشك الانتهاء.",
    push: false,
    email: true,
    canMuteInApp: false,
    group: "system",
  },
  {
    type: "WEBHOOK_FAILED",
    label: "فشل استقبال الرسائل",
    hint: "فشل تسليم من Meta إلى المنصة.",
    push: false,
    email: true,
    canMuteInApp: false,
    group: "system",
  },
  {
    type: "QUEUE_DEPTH_HIGH",
    label: "تراكم في طابور المعالجة",
    hint: "الرسائل تتراكم أسرع من معالجتها.",
    push: false,
    email: false,
    canMuteInApp: true,
    group: "system",
  },
  {
    type: "META_RATE_LIMIT",
    label: "تقييد من Meta",
    hint: "Meta تحدّ من عدد الطلبات مؤقتًا.",
    push: false,
    email: false,
    canMuteInApp: true,
    group: "system",
  },
  {
    type: "AI_FAILURE",
    label: "تعطل المساعد الآلي",
    hint: "فشل توليد رد آلي.",
    push: false,
    email: false,
    canMuteInApp: true,
    group: "system",
  },
  {
    type: "PLAN_LIMIT_WARNING",
    label: "اقتراب حد الباقة",
    hint: "بلغ الاستهلاك ٨٠٪ من حد الباقة الشهري.",
    push: false,
    email: true,
    canMuteInApp: true,
    group: "billing",
  },
  {
    type: "PLAN_LIMIT_REACHED",
    label: "بلوغ حد الباقة",
    hint: "توقف الرد الآلي لبقية الشهر — المحادثات ما زالت تصل للموظفين.",
    push: false,
    email: true,
    canMuteInApp: false,
    group: "billing",
  },
  {
    type: "TRIAL_ENDING",
    label: "اقتراب انتهاء التجربة",
    hint: "تنتهي الفترة التجريبية خلال أيام.",
    push: false,
    email: true,
    canMuteInApp: true,
    group: "billing",
  },
  {
    type: "SUBSCRIPTION_EXPIRED",
    label: "انتهاء الاشتراك",
    hint: "الاشتراك غير نشط والرد الآلي متوقف.",
    push: false,
    email: true,
    canMuteInApp: false,
    group: "billing",
  },
  {
    type: "UNAUTHORIZED_ACCESS",
    label: "محاولة وصول غير مصرّح",
    hint: "طلب حاول تجاوز حدود المؤسسة أو الصلاحيات.",
    push: false,
    email: false,
    canMuteInApp: false,
    group: "system",
  },
  {
    type: "SEQUENCE_STEP_FAILED",
    label: "تعذّرت متابعة تلقائية",
    hint: "خطوة في تسلسل متابعة لم تُنفَّذ، والعميل يحتاج متابعة يدوية.",
    // Worth interrupting for: the whole point of the sequence was that nobody
    // had to remember this lead, and it just stopped being true.
    push: true,
    email: false,
    canMuteInApp: true,
    group: "leads",
  },
];

const BY_TYPE = new Map(NOTIFICATION_TYPES.map((t) => [t.type, t]));

export const PREF_GROUPS: { key: TypeDef["group"]; label: string }[] = [
  { key: "leads", label: "العملاء والمهام" },
  { key: "service", label: "خدمة المحادثات" },
  { key: "system", label: "صحة النظام" },
  { key: "billing", label: "الاشتراك والباقة" },
];

/**
 * What a member should actually receive for one type, after their stored
 * overrides and the un-mutable floor are both applied.
 *
 * An unknown type (an enum value added to the schema before it was added here)
 * resolves to in-app on, email off — visible but not noisy, which is the safe
 * side to fail on.
 */
export function resolveChannels(
  raw: unknown,
  type: string,
): { inApp: boolean; email: boolean; push: boolean } {
  const def = BY_TYPE.get(type);
  const stored = (raw as PrefMap | null | undefined)?.[type];

  const inApp = def && !def.canMuteInApp ? true : (stored?.inApp ?? true);
  const email = stored?.email ?? def?.email ?? false;
  const push = stored?.push ?? def?.push ?? false;
  return { inApp, email, push };
}

/** The full resolved map, for the settings screen. */
export function resolveAll(raw: unknown): PrefMap {
  return Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.type, resolveChannels(raw, t.type)]));
}

/**
 * Normalise submitted preferences: drop unknown types, coerce to booleans, and
 * force the un-mutable in-app channel back on so a crafted request cannot store
 * a preference the read path would then have to defend against.
 */
export function sanitizePrefs(input: unknown): PrefMap {
  const src = (input ?? {}) as Record<string, { inApp?: unknown; email?: unknown; push?: unknown }>;
  const out: PrefMap = {};
  for (const def of NOTIFICATION_TYPES) {
    const v = src[def.type];
    if (!v || typeof v !== "object") continue;
    out[def.type] = {
      inApp: def.canMuteInApp ? Boolean(v.inApp) : true,
      email: Boolean(v.email),
      push: Boolean(v.push),
    };
  }
  return out;
}
