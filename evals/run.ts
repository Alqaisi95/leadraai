/**
 * AI reply eval — runs every case in evals/cases.json through the SAME
 * draftReply() the live inbox uses, then scores it (src/lib/ai/eval.ts).
 *
 *   ANTHROPIC_API_KEY=... npm run eval
 *   npm run eval -- --model claude-sonnet-4-6 --only iq-  --prompt my-prompt.txt
 *
 * Writes evals/report.json and evals/report.md. Exits 1 below EVAL_MIN_PASS (default 0.85).
 * Run it before changing the prompt or the model, and compare the two reports.
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { draftReply, type Draft, type ModelClient } from "../src/lib/ai/respond";
import { DEFAULT_SYSTEM_PROMPT } from "../src/lib/ai/prompts";
import { scoreCase, summarize, type EvalCase } from "../src/lib/ai/eval";

type Suite = {
  orgName: string;
  defaults: { inventory: EvalCase["inventory"]; knowledge: EvalCase["knowledge"] };
  cases: EvalCase[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** --fake: canned model output, to smoke-test the runner without an API key or cost. */
const fakeClient: ModelClient = {
  messages: {
    create: async () => ({
      content: [{ type: "text", text: JSON.stringify({ reply: "أهلاً بك! كيف أقدر أساعدك؟", confidence: 0.8, handoff: false, handoff_reason: null, intent: "inquiry", extracted: {} }) }],
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  },
};

async function main() {
  const fake = process.argv.includes("--fake");
  if (!fake && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set");
    process.exit(2);
  }
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const suite: Suite = JSON.parse(readFileSync(path.join(dir, "cases.json"), "utf8"));
  const only = arg("only");
  const model = arg("model") ?? process.env.AI_MODEL;
  const promptFile = arg("prompt");
  const promptTemplate = promptFile ? readFileSync(promptFile, "utf8") : DEFAULT_SYSTEM_PROMPT;
  const systemPrompt = promptTemplate.replace("{{ORG_NAME}}", suite.orgName);
  const minPass = Number(process.env.EVAL_MIN_PASS ?? 0.85);

  const cases = suite.cases.filter((c) => !only || c.id.startsWith(only));
  console.log(`Running ${cases.length} cases on ${model ?? "default model"}…`);

  const drafts: Draft[] = await pool(cases, 4, (c) =>
    draftReply({
      systemPrompt,
      model,
      history: c.history,
      inventory: c.inventory ?? suite.defaults.inventory ?? [],
      knowledgeChunks: (c.knowledge ?? suite.defaults.knowledge ?? []).map((k) => ({ sourceTitle: k.title, content: k.content })),
    }, ...(fake ? [fakeClient] : [])),
  );
  const results = cases.map((c, i) => scoreCase(c, drafts[i]));
  const summary = summarize(results, cases);
  const tokens = drafts.reduce((n, d) => n + (d.usage ? d.usage.input + d.usage.output : 0), 0);
  const avgLatency = Math.round(drafts.reduce((n, d) => n + d.latencyMs, 0) / Math.max(1, drafts.length));

  const lines = [
    `# AI eval — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    "",
    `**${summary.passed}/${summary.total} passed (${Math.round(summary.rate * 100)}%)** · model \`${drafts[0]?.model ?? model}\`${promptFile ? ` · prompt \`${promptFile}\`` : ""} · ${tokens} tokens · avg ${avgLatency} ms`,
    "",
    "| Category | Passed |",
    "| --- | --- |",
    ...Object.entries(summary.byCategory).map(([k, v]) => `| ${k} | ${v.pass}/${v.total} |`),
    "",
    "| Case | Dialect | Result | Decision | Reply |",
    "| --- | --- | --- | --- | --- |",
    ...results.map((r, i) => {
      const d = drafts[i];
      const decision = d.decision.handoff ? `handoff: ${d.decision.reason}` : "reply";
      const reply = (d.ai?.reply ?? d.error ?? d.raw).replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 120);
      return `| ${r.id} | ${cases[i].dialect} | ${r.pass ? "✅" : "❌ " + r.failures.join("; ").replace(/\|/g, "/")} | ${decision} | ${reply} |`;
    }),
  ];
  writeFileSync(path.join(dir, "report.md"), lines.join("\n") + "\n");
  writeFileSync(
    path.join(dir, "report.json"),
    JSON.stringify({ summary, model: drafts[0]?.model, prompt: promptFile ?? "default", results: results.map((r, i) => ({ ...r, decision: drafts[i].decision, reply: drafts[i].ai?.reply ?? null, extracted: drafts[i].ai?.extracted ?? null })) }, null, 2),
  );

  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id}${r.pass ? "" : "  — " + r.failures.join("; ")}`);
  console.log(`\n${summary.passed}/${summary.total} passed (${Math.round(summary.rate * 100)}%) — report: evals/report.md`);
  process.exit(fake || summary.rate >= minPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
