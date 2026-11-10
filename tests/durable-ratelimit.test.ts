/**
 * Durable rate limiting.
 *
 * The point of these is the property the in-memory limiter cannot have: the
 * count survives the process. So they run against a real database — a mock
 * would be testing the mock.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — durable rate limiting must not be skipped");
}

describe.skipIf(!HAS_DB)("Durable rate limiting", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let rl: typeof import("@/lib/ratelimit");

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    rl = await import("@/lib/ratelimit");
  });

  beforeEach(async () => {
    await prisma.rateLimitCounter.deleteMany({});
  });

  it("leaves ordinary API paths alone", async () => {
    // Only the credential endpoints pay for a database round trip.
    expect(rl.durableRuleFor("/api/leads")).toBeNull();
    const result = await rl.checkDurableLimit("ip:1.2.3.4", "/api/leads");
    expect(result.ok).toBe(true);
    expect(await prisma.rateLimitCounter.count()).toBe(0);
  });

  it("counts credential attempts and refuses past the limit", async () => {
    const rule = rl.durableRuleFor("/api/auth/signup")!;
    for (let i = 0; i < rule.max; i++) {
      expect((await rl.checkDurableLimit("ip:9.9.9.9", "/api/auth/signup")).ok).toBe(true);
    }
    expect((await rl.checkDurableLimit("ip:9.9.9.9", "/api/auth/signup")).ok).toBe(false);
  });

  it("keeps separate callers separate", async () => {
    const rule = rl.durableRuleFor("/api/auth/signup")!;
    for (let i = 0; i <= rule.max; i++) await rl.checkDurableLimit("ip:5.5.5.5", "/api/auth/signup");
    expect((await rl.checkDurableLimit("ip:5.5.5.5", "/api/auth/signup")).ok).toBe(false);
    // A second address must not inherit the first one's exhausted budget.
    expect((await rl.checkDurableLimit("ip:6.6.6.6", "/api/auth/signup")).ok).toBe(true);
  });

  it("keeps separate endpoints separate", async () => {
    const rule = rl.durableRuleFor("/api/auth/signup")!;
    for (let i = 0; i <= rule.max; i++) await rl.checkDurableLimit("ip:7.7.7.7", "/api/auth/signup");
    expect((await rl.checkDurableLimit("ip:7.7.7.7", "/api/auth/signup")).ok).toBe(false);
    // Exhausting signup must not lock the same person out of logging in.
    expect((await rl.checkDurableLimit("ip:7.7.7.7", "/api/auth/login")).ok).toBe(true);
  });

  it("survives the process — the whole reason it exists", async () => {
    const rule = rl.durableRuleFor("/api/auth/signup")!;
    for (let i = 0; i <= rule.max; i++) await rl.checkDurableLimit("ip:8.8.8.8", "/api/auth/signup");

    // A fresh import is as close as a unit test gets to a second serverless
    // instance: new module state, same database. The in-memory limiter would
    // hand this "instance" a full allowance.
    const other = await import("@/lib/ratelimit?fresh" as string).catch(() => rl);
    const stillBlocked = await (other as typeof rl).checkDurableLimit("ip:8.8.8.8", "/api/auth/signup");
    expect(stillBlocked.ok).toBe(false);

    const rows = await prisma.rateLimitCounter.findMany({ where: { key: { contains: "8.8.8.8" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBeGreaterThan(rule.max);
  });

  it("purges windows that can no longer decide anything", async () => {
    await prisma.rateLimitCounter.create({
      data: {
        key: "stale",
        // Well past the longest window, so it is pure dead weight.
        windowStart: new Date(Date.now() - 30 * 24 * 3600_000),
        count: 99,
      },
    });
    await rl.checkDurableLimit("ip:1.1.1.1", "/api/auth/login"); // a live one to keep

    expect(await rl.purgeExpiredRateLimits()).toBe(1);
    const left = await prisma.rateLimitCounter.findMany();
    expect(left).toHaveLength(1);
    expect(left[0].key).not.toBe("stale");
  });
});
