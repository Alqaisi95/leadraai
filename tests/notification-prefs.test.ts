import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  resolveAll,
  resolveChannels,
  sanitizePrefs,
} from "../src/lib/notification-prefs";

/** What lib/notify.ts emailed before preferences existed. */
const LEGACY_EMAIL_TYPES = ["HIGH_SCORE_LEAD", "COMPLAINT", "WEBHOOK_FAILED", "TOKEN_EXPIRING", "SLA_BREACH"];
/** Types added after preferences shipped — no legacy behaviour to preserve. */
const POST_LEGACY_TYPES = [
  "PLAN_LIMIT_WARNING",
  "PLAN_LIMIT_REACHED",
  "TRIAL_ENDING",
  "SUBSCRIPTION_EXPIRED",
];

describe("resolveChannels", () => {
  it("keeps the pre-preferences email behaviour for a member who never set anything", () => {
    for (const t of NOTIFICATION_TYPES) {
      if (POST_LEGACY_TYPES.includes(t.type)) continue;
      expect(resolveChannels(null, t.type).email).toBe(LEGACY_EMAIL_TYPES.includes(t.type));
    }
  });

  it("emails billing alerts by default — an unnoticed limit stops the product", () => {
    for (const t of POST_LEGACY_TYPES) {
      expect(resolveChannels(null, t).email).toBe(true);
    }
  });

  it("shows everything in-app by default", () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(resolveChannels(null, t.type).inApp).toBe(true);
    }
  });

  it("lets a member opt in to a type that is quiet by default", () => {
    expect(resolveChannels({ TASK_OVERDUE: { inApp: true, email: true } }, "TASK_OVERDUE").email).toBe(true);
  });

  it("lets a member opt out of a type that emails by default", () => {
    expect(resolveChannels({ HIGH_SCORE_LEAD: { inApp: true, email: false } }, "HIGH_SCORE_LEAD").email).toBe(
      false,
    );
  });

  it("ignores a stored mute on a critical alert", () => {
    const muted = { SLA_BREACH: { inApp: false, email: false } };
    expect(resolveChannels(muted, "SLA_BREACH").inApp).toBe(true);
    // the email half of the same preference is still honoured
    expect(resolveChannels(muted, "SLA_BREACH").email).toBe(false);
  });

  it("leaves other types alone when one is overridden", () => {
    const prefs = { COMPLAINT: { inApp: false, email: false, push: false } };
    // push is on by default for this type — it is one of the few worth
    // interrupting someone for.
    expect(resolveChannels(prefs, "HIGH_SCORE_LEAD")).toEqual({ inApp: true, email: true, push: true });
  });

  it("fails safe on a type it has never heard of", () => {
    // Visible but silent on every channel that leaves the system.
    expect(resolveChannels(null, "SOMETHING_NEW")).toEqual({ inApp: true, email: false, push: false });
  });
});

describe("sanitizePrefs", () => {
  it("drops unknown types instead of storing them", () => {
    expect(sanitizePrefs({ NOT_A_TYPE: { inApp: false, email: true } })).toEqual({});
  });

  it("forces the in-app channel back on for critical alerts", () => {
    const out = sanitizePrefs({ UNAUTHORIZED_ACCESS: { inApp: false, email: true, push: false } });
    expect(out.UNAUTHORIZED_ACCESS).toEqual({ inApp: true, email: true, push: false });
  });

  it("coerces junk values to booleans", () => {
    const out = sanitizePrefs({ TASK_OVERDUE: { inApp: "yes", email: 0, push: "" } });
    expect(out.TASK_OVERDUE).toEqual({ inApp: true, email: false, push: false });
  });

  it("survives a non-object payload", () => {
    expect(sanitizePrefs(null)).toEqual({});
    expect(sanitizePrefs({ COMPLAINT: "off" })).toEqual({});
  });

  it("round-trips through resolveAll unchanged", () => {
    const stored = sanitizePrefs({ COMPLAINT: { inApp: false, email: false, push: false } });
    const all = resolveAll(stored);
    expect(all.COMPLAINT).toEqual({ inApp: false, email: false, push: false });
    expect(Object.keys(all)).toHaveLength(NOTIFICATION_TYPES.length);
  });
});
