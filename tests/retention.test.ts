/**
 * Data retention.
 *
 * These run against an in-memory stand-in for Prisma rather than a database,
 * deliberately: the behaviour worth pinning down is which rows each rule
 * selects, and that is a property of the rules, not of Postgres. It also means
 * the suite verifies them everywhere, including on a machine whose only
 * configured database is production.
 *
 * The cases that matter are the ones where deleting the wrong row costs
 * something: a conversation the product exists to keep, a failed webhook that
 * is the only record of a problem, or an idempotency key young enough that a
 * replay would be processed twice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const DAY = 86_400_000;
const NOW = new Date("2026-10-28T12:00:00.000Z");

interface Row {
  id: string;
  [k: string]: unknown;
}

/** Tables the fake knows about, keyed as Prisma's delegates are. */
let tables: Record<string, Row[]>;
/** Delegates told to throw, to test failure isolation. */
let broken: Set<string>;
/** Every `take` the code asked for, to prove batching. */
let takes: number[];

function delegate(name: string) {
  return {
    findMany: async ({ where, take }: any) => {
      if (broken.has(name)) throw new Error("permission denied");
      takes.push(take);
      return tables[name]
        .filter((r) => matches(r, where))
        .slice(0, take)
        .map((r) => ({ id: r.id }));
    },
    deleteMany: async ({ where }: any) => {
      if (broken.has(name)) throw new Error("permission denied");
      const ids: string[] = where.id.in;
      const before = tables[name].length;
      tables[name] = tables[name].filter((r) => !ids.includes(r.id));
      return { count: before - tables[name].length };
    },
  };
}

/** Supports exactly the `where` shapes the rules use: `{ lt }` and `{ in }`. */
function matches(row: Row, where: Record<string, any>): boolean {
  return Object.entries(where).every(([field, cond]) => {
    const v = row[field];
    if (cond && typeof cond === "object" && "lt" in cond) return (v as Date) < cond.lt;
    if (cond && typeof cond === "object" && "in" in cond) return cond.in.includes(v);
    return v === cond;
  });
}

vi.mock("@/lib/db", () => ({
  prisma: {
    get jobRun() {
      return delegate("jobRun");
    },
    get loginAttempt() {
      return delegate("loginAttempt");
    },
    get webhookEvent() {
      return delegate("webhookEvent");
    },
    get auditLog() {
      return delegate("auditLog");
    },
    get message() {
      return delegate("message");
    },
    get conversation() {
      return delegate("conversation");
    },
  },
}));

/** A row `days` old, with the timestamp field this table uses. */
function aged(id: string, field: string, days: number, extra: Row | object = {}): Row {
  return { id, [field]: new Date(NOW.getTime() - days * DAY), ...extra };
}

describe("Data retention", () => {
  let lib: typeof import("@/lib/retention");

  beforeEach(async () => {
    tables = {
      jobRun: [],
      loginAttempt: [],
      webhookEvent: [],
      auditLog: [],
      message: [],
      conversation: [],
    };
    broken = new Set();
    takes = [];
    lib = await import("@/lib/retention");
  });

  describe("cutoffFor", () => {
    it("is the given number of days before now", () => {
      expect(lib.cutoffFor(90, NOW).toISOString()).toBe("2026-07-30T12:00:00.000Z");
    });

    it("never reaches into the future", () => {
      for (const d of [1, 30, 60, 90, 365]) {
        expect(lib.cutoffFor(d, NOW).getTime()).toBeLessThan(NOW.getTime());
      }
    });
  });

  describe("what it removes", () => {
    it("removes job runs past 90 days and keeps the rest", async () => {
      tables.jobRun = [
        aged("old", "startedAt", 91),
        aged("ancient", "startedAt", 400),
        aged("recent", "startedAt", 89),
        aged("today", "startedAt", 0),
      ];

      const r = await lib.purgeExpiredData(NOW);

      expect(r.removed["job_runs"]).toBe(2);
      expect(tables.jobRun.map((x) => x.id).sort()).toEqual(["recent", "today"]);
    });

    it("removes login attempts past 30 days", async () => {
      tables.loginAttempt = [aged("a", "createdAt", 31), aged("b", "createdAt", 29)];

      await lib.purgeExpiredData(NOW);

      // The lockout logic only ever reads a window of minutes, so nothing
      // mechanical depends on the removed row.
      expect(tables.loginAttempt.map((x) => x.id)).toEqual(["b"]);
    });

    it("removes audit entries past a year", async () => {
      tables.auditLog = [aged("a", "createdAt", 366), aged("b", "createdAt", 364)];

      await lib.purgeExpiredData(NOW);

      expect(tables.auditLog.map((x) => x.id)).toEqual(["b"]);
    });
  });

  describe("what it must not remove", () => {
    it("never touches messages or conversations", async () => {
      // They are the product. However old a conversation is, how long a tenant
      // keeps it is a product decision, and this job does not make it.
      tables.message = [aged("m", "createdAt", 5_000)];
      tables.conversation = [aged("c", "createdAt", 5_000)];

      await lib.purgeExpiredData(NOW);

      expect(tables.message).toHaveLength(1);
      expect(tables.conversation).toHaveLength(1);
    });

    it("keeps a failed webhook that a processed one of the same age loses", async () => {
      // DEAD_LETTER is the "a human must look at this" state. Pruning it on the
      // 60-day clock would discard the only record of the failure.
      tables.webhookEvent = [
        aged("processed", "receivedAt", 61, { status: "PROCESSED" }),
        aged("dead", "receivedAt", 61, { status: "DEAD_LETTER" }),
        aged("failed", "receivedAt", 61, { status: "FAILED" }),
      ];

      await lib.purgeExpiredData(NOW);

      expect(tables.webhookEvent.map((x) => x.id).sort()).toEqual(["dead", "failed"]);
    });

    it("removes a failed webhook once it passes a year", async () => {
      tables.webhookEvent = [aged("dead", "receivedAt", 366, { status: "DEAD_LETTER" })];

      await lib.purgeExpiredData(NOW);

      expect(tables.webhookEvent).toHaveLength(0);
    });

    it("keeps an idempotency key young enough to still be replayed", async () => {
      // (provider, externalEventId) on webhook_events is the idempotency key:
      // delete the row and a replay of that event is processed a second time.
      // Meta retries over hours, so a 59-day-old key must survive.
      tables.webhookEvent = [aged("yesterday", "receivedAt", 1, { status: "PROCESSED" })];

      await lib.purgeExpiredData(NOW);

      expect(tables.webhookEvent).toHaveLength(1);
    });
  });

  describe("robustness", () => {
    it("prunes the other tables when one of them fails", async () => {
      // These are independent. A lock or permission problem on one is no
      // reason to let the rest keep growing.
      broken.add("auditLog");
      tables.auditLog = [aged("a", "createdAt", 400)];
      tables.jobRun = [aged("j", "startedAt", 100)];

      const r = await lib.purgeExpiredData(NOW);

      expect(r.removed["job_runs"]).toBe(1);
      expect(r.failed).toHaveLength(1);
      expect(r.failed[0]).toContain("audit_logs");
    });

    it("deletes in bounded batches rather than one unbounded statement", async () => {
      // The first run is when the table is largest; an unbounded deleteMany
      // would hold locks long enough to time out.
      tables.jobRun = Array.from({ length: 2_500 }, (_, i) => aged(`j${i}`, "startedAt", 100));

      const r = await lib.purgeExpiredData(NOW);

      expect(r.removed["job_runs"]).toBe(2_500);
      expect(Math.max(...takes)).toBeLessThanOrEqual(1_000);
      expect(tables.jobRun).toHaveLength(0);
    });

    it("reports a total across tables", async () => {
      tables.jobRun = [aged("j", "startedAt", 100)];
      tables.loginAttempt = [aged("l", "createdAt", 100)];

      expect((await lib.purgeExpiredData(NOW)).total).toBe(2);
    });

    it("does nothing when everything is inside its window", async () => {
      tables.jobRun = [aged("j", "startedAt", 1)];
      tables.auditLog = [aged("a", "createdAt", 1)];

      const r = await lib.purgeExpiredData(NOW);

      expect(r.total).toBe(0);
      expect(r.failed).toHaveLength(0);
    });
  });
});
