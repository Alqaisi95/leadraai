/**
 * Rate limiting (R1.4).
 * On Cloudflare: the Workers Rate Limiting bindings (RL_LOGIN, RL_API in
 * wrangler.jsonc) — shared across all isolates in a location, unlike memory.
 * Elsewhere (next dev, tests, Node worker): an in-memory sliding window.
 */
import { cfEnv, type RateLimitBinding } from "./cf";

type Rule = { pattern: RegExp; max: number; windowMs: number; binding: "RL_LOGIN" | "RL_API" };

const RULES: Rule[] = [
  { pattern: /^\/api\/auth\/login/, max: 10, windowMs: 60_000, binding: "RL_LOGIN" },
  { pattern: /^\/api\//, max: 120, windowMs: 60_000, binding: "RL_API" }, // default per user
];

export type RateLimitResult = { ok: boolean; remaining: number; limit: number };

function ruleFor(path: string): Rule {
  return RULES.find((r) => r.pattern.test(path)) ?? RULES[RULES.length - 1];
}

export async function checkRateLimit(key: string, path: string): Promise<RateLimitResult> {
  const rule = ruleFor(path);
  const binding: RateLimitBinding | undefined = cfEnv()?.[rule.binding];
  if (binding) {
    try {
      const { success } = await binding.limit({ key });
      return { ok: success, remaining: success ? -1 : 0, limit: rule.max };
    } catch (e) {
      console.error("ratelimit_binding_failed", String(e).slice(0, 200));
      // fall through to memory rather than blocking traffic
    }
  }
  return checkInMemory(key, rule);
}

// ---------- in-memory fallback ----------
const buckets = new Map<string, number[]>();

function checkInMemory(key: string, rule: Rule): RateLimitResult {
  const now = Date.now();
  const bucketKey = `${key}:${rule.binding}`;
  const hits = (buckets.get(bucketKey) ?? []).filter((t) => now - t < rule.windowMs);
  const ok = hits.length < rule.max;
  if (ok) hits.push(now);
  buckets.set(bucketKey, hits);
  if (buckets.size > 10_000) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
  return { ok, remaining: Math.max(0, rule.max - hits.length), limit: rule.max };
}
