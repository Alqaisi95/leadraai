/**
 * Health check for uptime monitors and the ops dashboard.
 *  - Public:  { ok } — 200 when the database answers, 503 otherwise.
 *  - With `Authorization: Bearer CRON_SECRET`: queue depth, dead letters,
 *    the age of the oldest waiting event, and the last successful processing.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const STUCK_AFTER_SEC = 300; // a queued event older than 5 min means processing is stalled

export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    console.error("health_db_failed", String(e).slice(0, 200));
    return NextResponse.json({ ok: false, db: false }, { status: 503 });
  }
  const dbMs = Date.now() - started;

  const authorized =
    !!process.env.CRON_SECRET && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  if (!authorized) return NextResponse.json({ ok: true });

  const [byStatus, oldestQueued, lastProcessed] = await Promise.all([
    prisma.webhookEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.webhookEvent.findFirst({
      where: { status: "QUEUED", NOT: { externalEventId: { startsWith: "oauth_state:" } } },
      orderBy: { receivedAt: "asc" },
      select: { receivedAt: true },
    }),
    prisma.webhookEvent.findFirst({
      where: { status: "PROCESSED" },
      orderBy: { processedAt: "desc" },
      select: { processedAt: true },
    }),
  ]);

  const counts = Object.fromEntries(
    byStatus.map((r: { status: string; _count: { _all: number } }) => [r.status, r._count._all]),
  ) as Record<string, number>;
  const oldestQueuedSec = oldestQueued ? Math.round((Date.now() - oldestQueued.receivedAt.getTime()) / 1000) : 0;
  const stalled = oldestQueuedSec > STUCK_AFTER_SEC;

  return NextResponse.json(
    {
      ok: !stalled,
      db: { ok: true, latencyMs: dbMs },
      queue: {
        queued: counts.QUEUED ?? 0,
        processing: counts.PROCESSING ?? 0,
        deadLetter: counts.DEAD_LETTER ?? 0,
        oldestQueuedSec,
        stalled,
      },
      lastProcessedAt: lastProcessed?.processedAt ?? null,
      aiModel: process.env.AI_MODEL || "claude-sonnet-4-6",
    },
    { status: stalled ? 503 : 200 },
  );
}
