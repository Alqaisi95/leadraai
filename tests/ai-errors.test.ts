import { describe, it, expect } from "vitest";
import { AiUnavailableError, toAiError } from "@/lib/ai/assist";

/**
 * Every provider failure here is operational — no credit, revoked key, rate
 * limit. Collapsing them into a generic 500 leaves the operator with nothing to
 * act on, so each mapping is pinned to its own actionable message.
 *
 * Errors are shaped as plain objects on purpose: toAiError keys on `status`
 * rather than `instanceof` so it survives SDK class renames and duplicated
 * dependencies, and the tests should exercise that same contract.
 */
const err = (status: number | null, message: string) =>
  Object.assign(new Error(message), status === null ? {} : { status });

describe("toAiError — تصنيف أخطاء مزوّد الذكاء الاصطناعي", () => {
  it("maps an exhausted credit balance to NO_CREDIT", () => {
    const e = toAiError(err(400, "Your credit balance is too low to access the Anthropic API"));
    expect(e.code).toBe("NO_CREDIT");
    expect(e.arabic).toContain("رصيد");
  });

  it("detects the credit message regardless of status", () => {
    // the provider has returned this under more than one status over time
    expect(toAiError(err(402, "credit balance is too low")).code).toBe("NO_CREDIT");
    expect(toAiError(err(null, "Credit Balance too low")).code).toBe("NO_CREDIT");
  });

  it("maps a rejected key to BAD_KEY", () => {
    expect(toAiError(err(401, "invalid x-api-key")).code).toBe("BAD_KEY");
    expect(toAiError(err(403, "forbidden")).code).toBe("BAD_KEY");
  });

  it("maps a rate limit to RATE_LIMITED", () => {
    expect(toAiError(err(429, "rate limit exceeded")).code).toBe("RATE_LIMITED");
  });

  it("maps 5xx to OVERLOADED", () => {
    expect(toAiError(err(529, "overloaded")).code).toBe("OVERLOADED");
    expect(toAiError(err(500, "boom")).code).toBe("OVERLOADED");
  });

  it("does not mistake an ordinary 400 for a billing problem", () => {
    expect(toAiError(err(400, "max_tokens must be positive")).code).toBe("UNAVAILABLE");
  });

  it("passes an already-classified error through untouched", () => {
    const original = new AiUnavailableError("NO_KEY", "غير مفعّل");
    expect(toAiError(original)).toBe(original);
  });

  it("never throws on an unknown value", () => {
    for (const junk of [undefined, null, "boom", 42, {}, new Error("plain")]) {
      expect(toAiError(junk).code).toBe("UNAVAILABLE");
    }
  });

  it("always carries a non-empty Arabic message", () => {
    for (const c of [err(500, "x"), err(429, "x"), err(401, "x"), "junk", null]) {
      expect(toAiError(c).arabic.trim().length).toBeGreaterThan(0);
    }
  });
});
