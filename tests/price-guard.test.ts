import { describe, it, expect } from "vitest";
import { priceGuard, normalizePrices, parseAiJson, shouldHandoff } from "@/lib/ai/safety";

const INVENTORY = ["95000", "125000", "97000"];

describe("Price guard v2 (R4.7) — الحارس الأهم بالنظام", () => {
  it("allows prices that exist in inventory", () => {
    expect(priceGuard("السعر 95,000$ لشقة الغرفتين", INVENTORY)).toBe(true);
    expect(priceGuard("تبدأ من 95000 وحتى 125,000", INVENTORY)).toBe(true);
  });
  it("blocks hallucinated prices", () => {
    expect(priceGuard("السعر 85,000$ فقط لفترة محدودة", INVENTORY)).toBe(false);
    expect(priceGuard("متوفرة بـ 200000", INVENTORY)).toBe(false);
  });
  it("normalizes Arabic-Indic digits ٩٥٠٠٠", () => {
    expect(priceGuard("السعر ٩٥٠٠٠ دولار", INVENTORY)).toBe(true);
    expect(priceGuard("السعر ٨٥٠٠٠ دولار", INVENTORY)).toBe(false);
  });
  it('normalizes written thousands: "95 ألف" and "1.2 مليون"', () => {
    expect(normalizePrices("95 ألف")).toContain("95000");
    expect(priceGuard("السعر 95 ألف دولار", INVENTORY)).toBe(true);
    expect(priceGuard("السعر 85 الف", INVENTORY)).toBe(false);
    expect(priceGuard("فيلا بـ 1.2 مليون", INVENTORY)).toBe(false);
  });
  it("ignores years, areas, small numbers", () => {
    expect(priceGuard("التسليم 2027، المساحة 120م² و3 غرف", INVENTORY)).toBe(true);
  });
  it("empty inventory blocks every large number", () => {
    expect(priceGuard("السعر 95000", [])).toBe(false);
  });
});

describe("Handoff decision", () => {
  const base = { reply: "x", confidence: 0.9, handoff: false, handoff_reason: null, intent: "buy", extracted: {} };
  it("low confidence hands off", () => {
    expect(shouldHandoff({ ...base, confidence: 0.5 }, true).handoff).toBe(true);
  });
  it("price guard failure hands off regardless of confidence", () => {
    expect(shouldHandoff(base, false)).toEqual({ handoff: true, reason: "price_guard" });
  });
  it("complaint intent hands off", () => {
    expect(shouldHandoff({ ...base, intent: "complaint" }, true).handoff).toBe(true);
  });
  it("model-requested handoff respected", () => {
    expect(shouldHandoff({ ...base, handoff: true, handoff_reason: "human_requested" }, true).reason).toBe("human_requested");
  });
  it("confident, safe, non-complaint → no handoff", () => {
    expect(shouldHandoff(base, true).handoff).toBe(false);
  });
});

describe("AI JSON parsing", () => {
  it("parses fenced JSON", () => {
    const r = parseAiJson('```json\n{"reply":"أهلاً","confidence":0.8,"handoff":false,"handoff_reason":null,"intent":"buy","extracted":{}}\n```');
    expect(r?.reply).toBe("أهلاً");
  });
  it("rejects malformed output", () => {
    expect(parseAiJson("سأجيبك مباشرة: السعر هو...")).toBeNull();
  });
});
