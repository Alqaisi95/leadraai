/**
 * Data retention.
 *
 * Eight scheduled jobs ran before this one and not one of them deleted
 * anything. Five tables grow with traffic and have no ceiling — job_runs,
 * login_attempts, webhook_events, audit_logs, and the rate-limit counters
 * (already handled by purgeExpiredRateLimits). The database has a finite
 * compute and storage quota, and it has already been exhausted once in this
 * project's life, so unbounded growth is a known failure mode here rather than
 * a theoretical one.
 *
 * What is deliberately NOT pruned:
 *
 *   * **messages and conversations.** They are the product. A customer's
 *     conversation history is what the app is for, and deciding how long a
 *     tenant keeps it is a product and contractual question, not a
 *     housekeeping one. Nothing here touches them.
 *
 *   * **webhook_events in a failed state**, for sixty days. DEAD_LETTER is the
 *     "a human must look at this" state; deleting it on the same short clock
 *     as processed events would quietly discard the only record of a failure.
 *     They are pruned, but only after a year.
 *
 * Why each cutoff is what it is:
 *
 *   * job_runs — 90 days. Long enough to answer "has this job been running?"
 *     across a quarter, which is the question this table exists to answer, and
 *     the one that proved the live site was running stale code.
 *
 *   * login_attempts — 30 days. The lockout logic only ever reads a window of
 *     minutes; everything older is kept for investigation, not for mechanism.
 *
 *   * webhook_events (processed) — 60 days. This table's unique
 *     (provider, externalEventId) is the idempotency key, so deleting a row
 *     makes a replay of that event processable a second time. Meta retries on
 *     a scale of hours, so sixty days clears it by a wide margin. The same
 *     table also holds short-lived OAuth state rows, which expire in minutes.
 *
 *   * audit_logs — 365 days. The schema marks this table append-only, and that
 *     intent is about the application never rewriting history to cover a
 *     change. Expiring a year-old entry on a fixed schedule is a different act
 *     from mutating a recent one, and a year is the shortest window that
 *     survives an annual review. Note that nothing at the database level
 *     enforces the append-only rule today — it is convention.
 *
 * Deletes run in batches. A single unbounded deleteMany against a table that
 * has never been pruned would hold locks long enough to time out, and the
 * first run is exactly when the table is largest.
 */
import { prisma } from "./db";

const DAY = 86_400_000;

/** Rows per delete statement, and the ceiling on rows removed per table per run. */
const BATCH = 1_000;
const MAX_PER_TABLE = 50_000;

export interface RetentionRule {
  /** Shown in the job summary and the return value. */
  table: string;
  days: number;
  /** Deletes rows older than the cutoff, up to `limit`. Returns rows removed. */
  purge: (cutoff: Date, limit: number) => Promise<number>;
}

/**
 * Delete by primary key in batches.
 *
 * Prisma's deleteMany takes no limit, so the ids are selected first and then
 * removed. That keeps each statement bounded and lets the loop stop at
 * MAX_PER_TABLE instead of discovering the size of the backlog by locking the
 * table for the duration of it.
 */
async function purgeInBatches(
  findIds: (cutoff: Date, take: number) => Promise<{ id: string }[]>,
  deleteByIds: (ids: string[]) => Promise<{ count: number }>,
  cutoff: Date,
  limit: number,
): Promise<number> {
  let removed = 0;
  while (removed < limit) {
    const take = Math.min(BATCH, limit - removed);
    const rows = await findIds(cutoff, take);
    if (rows.length === 0) break;
    const { count } = await deleteByIds(rows.map((r) => r.id));
    removed += count;
    // A short batch means the backlog is drained; another query would return
    // nothing and cost a round trip.
    if (rows.length < take) break;
  }
  return removed;
}

export const RETENTION_RULES: RetentionRule[] = [
  {
    table: "job_runs",
    days: 90,
    purge: (cutoff, limit) =>
      purgeInBatches(
        (c, take) =>
          prisma.jobRun.findMany({
            where: { startedAt: { lt: c } },
            select: { id: true },
            take,
          }),
        (ids) => prisma.jobRun.deleteMany({ where: { id: { in: ids } } }),
        cutoff,
        limit,
      ),
  },
  {
    table: "login_attempts",
    days: 30,
    purge: (cutoff, limit) =>
      purgeInBatches(
        (c, take) =>
          prisma.loginAttempt.findMany({
            where: { createdAt: { lt: c } },
            select: { id: true },
            take,
          }),
        (ids) => prisma.loginAttempt.deleteMany({ where: { id: { in: ids } } }),
        cutoff,
        limit,
      ),
  },
  {
    table: "webhook_events",
    days: 60,
    purge: (cutoff, limit) =>
      purgeInBatches(
        (c, take) =>
          prisma.webhookEvent.findMany({
            // Processed only. A failed event is a record of a problem, and it
            // outlives this cutoff on purpose — see the rule below it.
            where: { receivedAt: { lt: c }, status: "PROCESSED" },
            select: { id: true },
            take,
          }),
        (ids) => prisma.webhookEvent.deleteMany({ where: { id: { in: ids } } }),
        cutoff,
        limit,
      ),
  },
  {
    table: "webhook_events (failed)",
    days: 365,
    purge: (cutoff, limit) =>
      purgeInBatches(
        (c, take) =>
          prisma.webhookEvent.findMany({
            where: { receivedAt: { lt: c }, status: { in: ["FAILED", "DEAD_LETTER"] } },
            select: { id: true },
            take,
          }),
        (ids) => prisma.webhookEvent.deleteMany({ where: { id: { in: ids } } }),
        cutoff,
        limit,
      ),
  },
  {
    table: "audit_logs",
    days: 365,
    purge: (cutoff, limit) =>
      purgeInBatches(
        (c, take) =>
          prisma.auditLog.findMany({
            where: { createdAt: { lt: c } },
            select: { id: true },
            take,
          }),
        (ids) => prisma.auditLog.deleteMany({ where: { id: { in: ids } } }),
        cutoff,
        limit,
      ),
  },
];

export function cutoffFor(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * DAY);
}

/**
 * Prune every table past its retention window. The job entry point.
 *
 * One table failing must not stop the rest: these are independent, and a
 * permission or lock problem on one is not a reason to let the others keep
 * growing. Failures are counted and named so the job summary shows them.
 */
export async function purgeExpiredData(now = new Date()) {
  const removed: Record<string, number> = {};
  const failed: string[] = [];

  for (const rule of RETENTION_RULES) {
    try {
      removed[rule.table] = await rule.purge(cutoffFor(rule.days, now), MAX_PER_TABLE);
    } catch (e) {
      failed.push(`${rule.table}: ${(e instanceof Error ? e.message : "error").slice(0, 80)}`);
    }
  }

  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  return { total, removed, failed };
}
