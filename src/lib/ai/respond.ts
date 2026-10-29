/**
 * One AI reply attempt: prompt → model → parse → code-level safety gates.
 * Shared by the live orchestrator and the offline eval runner (evals/run.ts),
 * so what is evaluated is exactly what runs in production.
 */
import Anthropic from "@anthropic-ai/sdk";
import { buildUserPrompt } from "./prompts";
import { parseAiJson, priceGuard, shouldHandoff, type AiJson } from "./safety";

export type InventoryItem = {
  unitNumber: string; project: string; type: string | null; bedrooms: number | null;
  areaSqm: string | null; price: string | null;
};

export type DraftInput = {
  systemPrompt: string;
  history: { role: string; text: string }[];
  knowledgeChunks: { content: string; sourceTitle: string; sourceId?: string }[];
  inventory: InventoryItem[];
  model?: string;
};

export type Draft = {
  ai: AiJson | null;
  raw: string;
  priceOk: boolean;
  decision: { handoff: boolean; reason: string | null };
  error: string | null;
  model: string;
  latencyMs: number;
  usage: { input: number; output: number } | null;
  costUsd: number | null;
};

/** Minimal surface of the Anthropic client — lets tests and evals inject a fake. */
export type ModelClient = {
  messages: {
    create(args: {
      model: string; max_tokens: number; system: string;
      messages: { role: "user"; content: string }[];
    }): Promise<{ content: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } }>;
  };
};

let defaultClient: ModelClient | null = null;
function client(): ModelClient {
  defaultClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as ModelClient;
  return defaultClient;
}

export const DEFAULT_MODEL = "claude-sonnet-4-6";

/** Cost from per-million-token prices in env (AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK), else null. */
function costOf(usage: Draft["usage"]): number | null {
  const pin = Number(process.env.AI_PRICE_INPUT_PER_MTOK);
  const pout = Number(process.env.AI_PRICE_OUTPUT_PER_MTOK);
  if (!usage || !Number.isFinite(pin) || !Number.isFinite(pout) || pin <= 0 || pout <= 0) return null;
  return (usage.input * pin + usage.output * pout) / 1_000_000;
}

export async function draftReply(input: DraftInput, modelClient: ModelClient = client()): Promise<Draft> {
  const started = Date.now();
  const model = input.model || process.env.AI_MODEL || DEFAULT_MODEL;
  const userPrompt = buildUserPrompt({
    history: input.history,
    knowledgeChunks: input.knowledgeChunks,
    inventory: input.inventory,
  });

  let raw = "";
  let error: string | null = null;
  let usage: Draft["usage"] = null;
  try {
    const completion = await modelClient.messages.create({
      model,
      max_tokens: 800,
      system: input.systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    raw = completion.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    if (completion.usage) usage = { input: completion.usage.input_tokens, output: completion.usage.output_tokens };
  } catch (e) {
    error = String(e).slice(0, 300);
  }

  const ai = error ? null : parseAiJson(raw);
  const priceOk = ai ? priceGuard(ai.reply, input.inventory.map((u) => u.price)) : false;
  const decision = ai ? shouldHandoff(ai, priceOk) : { handoff: true, reason: error ? "ai_failure" : "parse_failure" };

  return { ai, raw, priceOk, decision, error, model, latencyMs: Date.now() - started, usage, costUsd: costOf(usage) };
}

/** The question used for retrieval: the last two customer messages, newest last. */
export function retrievalQuery(history: { role: string; text: string }[]): string {
  return history.filter((m) => m.role === "CUSTOMER").slice(-2).map((m) => m.text).join(" ");
}

/** Shape stored in ai_runs.sources (JSON) — read back by the "why did the AI reply" view. */
export type AiRunDetails = {
  chunks: { sourceId?: string; title: string }[];
  reason: string | null;
  model: string;
  usage: Draft["usage"];
  terms: string[];
  intent: string | null;
};
