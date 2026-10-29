/**
 * Sliding-window rate limiter (R1.4).
 * In-memory per instance — sufficient for MVP/single region.
 * PRODUCTION NOTE: move to Redis/Upstash for multi-instance consistency.
 */
type Bucket = { hits: number[]; };
const buckets = new Map<string, Bucket>();

const LIMITS: { pattern: RegExp; max: number; windowMs: number }[] = [
  { pattern: /^\/api\/auth\/login/, max: 10, windowMs: 60_000 },
  { pattern: /^\/api\/webhooks\//, max: 600, windowMs: 60_000 },
  { pattern: /^\/api\//, max: 120, windowMs: 60_000 }, // default per user
];

export function checkRateLimit(key: string, path: string): { ok: boolean; remaining: number; limit: number } {
  const rule = LIMITS.find(l => l.pattern.test(path)) ?? LIMITS[LIMITS.length - 1];
  const now = Date.now();
  const bucketKey = `${key}:${rule.pattern.source}`;
  const bucket = buckets.get(bucketKey) ?? { hits: [] };
  bucket.hits = bucket.hits.filter(t => now - t < rule.windowMs);
  const ok = bucket.hits.length < rule.max;
  if (ok) bucket.hits.push(now);
  buckets.set(bucketKey, bucket);
  if (buckets.size > 10_000) { // basic memory cap
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }
  return { ok, remaining: Math.max(0, rule.max - bucket.hits.length), limit: rule.max };
}
