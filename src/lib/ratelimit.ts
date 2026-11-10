/**
 * Rate limiting, in two layers.
 *
 * `checkRateLimit` is a sliding window held in process memory. It is cheap and
 * it is per-instance, so on serverless the real allowance is the configured
 * limit times the number of warm instances. That is the right trade for the
 * ordinary API, where the limits exist to contain a runaway client.
 *
 * `checkDurableLimit` is a fixed window in Postgres, applied only to the
 * anonymous credential endpoints, where "the limit multiplied by however many
 * instances are warm" is not an acceptable answer. See the note beside DURABLE.
 */
import { prisma } from "./db";
import { captureError } from "./monitoring";

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

// First match wins, so the specific credential paths must precede the catch-all.
// Without their own entries they fell through to the 120/min default, which is a
// generous allowance for endpoints that either guess passwords or send mail to
// somebody else's inbox.
const LIMITS: { pattern: RegExp; max: number; windowMs: number }[] = [
  { pattern: /^\/api\/auth\/login/, max: 10, windowMs: 60_000 },
  // Each accepted request emails a real person, and the caller is anonymous.
  { pattern: /^\/api\/auth\/forgot/, max: 5, windowMs: 15 * 60_000 },
  { pattern: /^\/api\/auth\/reset/, max: 10, windowMs: 15 * 60_000 },
  // Every signup creates an organization, a trial, and a pipeline.
  { pattern: /^\/api\/auth\/signup/, max: 5, windowMs: 60 * 60_000 },
  { pattern: /^\/api\/webhooks\//, max: 600, windowMs: 60_000 },
  // Default per authenticated user. 120/min turned out to be tight enough to
  // hit a real operator: the dashboard alone fires six calls per load, the
  // inbox polls, and an agent moving quickly between screens gets there. The
  // E2E suite — one account driven through twenty-six flows in two minutes —
  // trips it reliably, which is a fair proxy for a fast human. Raised to a
  // level that still stops a runaway client, and made configurable so a
  // deployment can tune it without a code change.
  { pattern: /^\/api\//, max: Number(process.env.RATE_LIMIT_API_PER_MIN ?? 400), windowMs: 60_000 },
];

export function checkRateLimit(key: string, path: string): { ok: boolean; remaining: number; limit: number } {
  const rule = LIMITS.find((l) => l.pattern.test(path)) ?? LIMITS[LIMITS.length - 1];
  const now = Date.now();
  const bucketKey = `${key}:${rule.pattern.source}`;
  const bucket = buckets.get(bucketKey) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < rule.windowMs);
  const ok = bucket.hits.length < rule.max;
  if (ok) bucket.hits.push(now);
  buckets.set(bucketKey, bucket);
  if (buckets.size > 10_000) {
    // basic memory cap
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
  return { ok, remaining: Math.max(0, rule.max - bucket.hits.length), limit: rule.max };
}

// ---------------------------------------------------------------------------
// Durable limiter — for the anonymous credential endpoints only.
// ---------------------------------------------------------------------------

/**
 * Per-IP allowances that must hold across every running instance.
 *
 * Guessing the password of *one* account is already bounded durably: `login()`
 * counts failed attempts out of the database and locks the address for fifteen
 * minutes. What that does not stop is one source spraying a common password
 * across many different accounts, or hammering /forgot and /signup — those were
 * guarded only by a counter living inside a single process.
 *
 * Deliberately not applied to the rest of the API. Every check here is a write,
 * and putting one in front of all 58 routes would add database traffic to the
 * hot path to solve a problem the hot path does not have.
 */
const DURABLE: { pattern: RegExp; max: number; windowMs: number }[] = [
  { pattern: /^\/api\/auth\/login/, max: 30, windowMs: 15 * 60_000 },
  { pattern: /^\/api\/auth\/forgot/, max: 10, windowMs: 60 * 60_000 },
  { pattern: /^\/api\/auth\/signup/, max: 5, windowMs: 60 * 60_000 },
  { pattern: /^\/api\/auth\/reset/, max: 20, windowMs: 60 * 60_000 },
];

export function durableRuleFor(path: string) {
  return DURABLE.find((r) => r.pattern.test(path)) ?? null;
}

/**
 * Fixed-window counter. Less precise than the sliding window above — a caller
 * can spend one window's allowance at its end and the next at its start — but
 * it costs a single atomic statement instead of a row per hit, and these
 * endpoints do not need better than that.
 *
 * Fails **open** on a database error. A limiter that refuses logins because the
 * counter table is unreachable converts a degraded database into a total
 * outage, and the durable lockout in `login()` still stands underneath.
 */
export async function checkDurableLimit(
  key: string,
  path: string,
): Promise<{ ok: boolean; remaining: number; limit: number }> {
  const rule = durableRuleFor(path);
  if (!rule) return { ok: true, remaining: Infinity, limit: Infinity };

  const windowStart = new Date(Math.floor(Date.now() / rule.windowMs) * rule.windowMs);
  const compound = `${rule.pattern.source}|${key}`;

  try {
    const row = await prisma.rateLimitCounter.upsert({
      where: { key_windowStart: { key: compound, windowStart } },
      create: { key: compound, windowStart, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    return { ok: row.count <= rule.max, remaining: Math.max(0, rule.max - row.count), limit: rule.max };
  } catch (e) {
    captureError(e, { route: path, reason: "durable_rate_limit_unavailable" });
    return { ok: true, remaining: rule.max, limit: rule.max };
  }
}

/** Housekeeping for the cleanup job — counters are worthless once expired. */
export async function purgeExpiredRateLimits(): Promise<number> {
  const longest = Math.max(...DURABLE.map((r) => r.windowMs));
  const { count } = await prisma.rateLimitCounter.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - 2 * longest) } },
  });
  return count;
}
