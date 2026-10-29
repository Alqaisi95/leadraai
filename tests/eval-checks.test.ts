import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
vi.mock("../src/lib/db", () => ({ prisma: {} }));
import { scoreCase, summarize, type EvalCase } from "../src/lib/ai/eval";
import type { Draft } from "../src/lib/ai/respond";

function draft(over: Partial<Draft> & { reply?: string; intent?: string; extracted?: Record<string, unknown> } = {}): Draft {
  const { reply = "أهلاً", intent = "inquiry", extracted = {}, ...rest } = over;
  return {
    ai: { reply, confidence: 0.9, handoff: false, handoff_reason: null, intent, extracted },
    raw: "", priceOk: true, decision: { handoff: false, reason: null }, error: null,
    model: "m", latencyMs: 1, usage: null, costUsd: null, ...rest,
  };
}
const c = (expect: EvalCase["expect"]): EvalCase => ({ id: "x", dialect: "عراقي", category: "t", history: [], expect });

describe("scoreCase", () => {
  it("passes a reply that meets every expectation, regardless of spelling variants", () => {
    const r = scoreCase(
      c({ handoff: false, intents: ["buy"], replyIncludes: ["الأقساط", "95"], extracted: { area: "المنصور", budgetMax: "re:^1\\d{5}$" } }),
      draft({ reply: "الاقساط متاحة والسعر 95,000", intent: "buy", extracted: { area: "المنصور", budgetMax: 100000 } }),
    );
    expect(r).toEqual({ id: "x", pass: true, failures: [] });
  });

  it("reports each failure", () => {
    const r = scoreCase(c({ handoff: true, replyExcludes: ["تم الحجز"] }), draft({ reply: "تم الحجز!" }));
    expect(r.pass).toBe(false);
    expect(r.failures).toHaveLength(2);
  });

  it("does not demand content from a reply that was blocked and handed off", () => {
    const blocked = draft({ reply: "سعرها 80 ألف", decision: { handoff: true, reason: "price_guard" } });
    expect(scoreCase(c({ replyIncludes: ["95"] }), blocked).pass).toBe(true);
    expect(scoreCase(c({ handoff: true, reasons: ["complaint"] }), blocked).failures[0]).toContain("price_guard");
  });

  it("fails invalid JSON and API errors", () => {
    expect(scoreCase(c({}), { ...draft(), ai: null }).failures[0]).toContain("JSON");
    expect(scoreCase(c({}), { ...draft(), ai: null, error: "429" }).failures[0]).toContain("429");
  });
});

describe("evals/cases.json", () => {
  const suite = JSON.parse(readFileSync("evals/cases.json", "utf8"));
  it("has unique ids, a dialect and a category for every case", () => {
    const ids = suite.cases.map((x: EvalCase) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of suite.cases) {
      expect(x.dialect).toBeTruthy();
      expect(x.category).toBeTruthy();
      expect(x.history.at(-1).role).toBe("CUSTOMER");
    }
    expect(suite.cases.length).toBeGreaterThanOrEqual(30);
  });

  it("summarizes by category", () => {
    const s = summarize([{ id: "a", pass: true, failures: [] }, { id: "b", pass: false, failures: ["x"] }], [
      { ...c({}), category: "أسعار" }, { ...c({}), category: "أسعار" },
    ]);
    expect(s).toMatchObject({ passed: 1, total: 2, rate: 0.5, byCategory: { "أسعار": { pass: 1, total: 2 } } });
  });
});
