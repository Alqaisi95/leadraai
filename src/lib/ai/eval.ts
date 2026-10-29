/**
 * Scoring for AI reply eval cases (evals/cases.json). Pure — unit-tested in
 * tests/eval-checks.test.ts and used by evals/run.ts against the real model.
 */
import { normalizeArabic } from "./knowledge";
import type { Draft, InventoryItem } from "./respond";

export type EvalCase = {
  id: string;
  dialect: string;
  category: string;
  note?: string;
  history: { role: "CUSTOMER" | "AI" | "AGENT"; text: string }[];
  inventory?: InventoryItem[];
  knowledge?: { title: string; content: string }[];
  expect: {
    handoff?: boolean;                      // omit = either is fine
    reasons?: string[];                     // allowed handoff reasons
    intents?: string[];                     // allowed intents
    extracted?: Record<string, string | number>; // field → exact value, or "re:<regex>"
    replyIncludes?: string[];               // each must appear (normalized), only checked when replying
    replyExcludes?: string[];               // none may appear (normalized)
  };
};

export type CaseResult = { id: string; pass: boolean; failures: string[] };

function matches(value: unknown, expected: string | number): boolean {
  if (value === null || value === undefined) return false;
  if (typeof expected === "string" && expected.startsWith("re:")) return new RegExp(expected.slice(3), "i").test(String(value));
  if (typeof expected === "number") return Number(value) === expected;
  return normalizeArabic(String(value)).trim() === normalizeArabic(expected).trim();
}

export function scoreCase(c: EvalCase, d: Draft): CaseResult {
  const f: string[] = [];
  const e = c.expect;

  if (d.error) f.push(`API error: ${d.error}`);
  if (!d.ai && !d.error) f.push("output is not valid JSON");

  if (e.handoff !== undefined && d.decision.handoff !== e.handoff) {
    f.push(`handoff expected ${e.handoff}, got ${d.decision.handoff} (${d.decision.reason ?? "—"})`);
  }
  if (e.reasons && d.decision.handoff && !e.reasons.includes(d.decision.reason ?? "")) {
    f.push(`handoff reason "${d.decision.reason}" not in [${e.reasons.join(", ")}]`);
  }
  if (e.intents && d.ai && !e.intents.includes(d.ai.intent)) {
    f.push(`intent "${d.ai.intent}" not in [${e.intents.join(", ")}]`);
  }
  if (e.extracted && d.ai) {
    for (const [k, v] of Object.entries(e.extracted)) {
      const got = (d.ai.extracted ?? {})[k];
      if (!matches(got, v)) f.push(`extracted.${k}: expected ${v}, got ${JSON.stringify(got ?? null)}`);
    }
  }
  // a price-guard block is already a safe outcome; only a reply that would be SENT is checked for content
  const reply = d.ai && !d.decision.handoff ? normalizeArabic(d.ai.reply) : null;
  if (reply !== null) {
    for (const s of e.replyIncludes ?? []) if (!reply.includes(normalizeArabic(s))) f.push(`reply should mention "${s}"`);
  }
  if (d.ai) {
    const any = normalizeArabic(d.ai.reply);
    for (const s of e.replyExcludes ?? []) if (any.includes(normalizeArabic(s))) f.push(`reply must not mention "${s}"`);
  }
  return { id: c.id, pass: f.length === 0, failures: f };
}

export function summarize(results: CaseResult[], cases: EvalCase[]) {
  const byCategory: Record<string, { pass: number; total: number }> = {};
  results.forEach((r, i) => {
    const cat = cases[i].category;
    byCategory[cat] ??= { pass: 0, total: 0 };
    byCategory[cat].total++;
    if (r.pass) byCategory[cat].pass++;
  });
  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, rate: results.length ? passed / results.length : 0, byCategory };
}
