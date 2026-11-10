/**
 * Liveness probe. The bare `status` is public so an uptime checker can hit it
 * without a credential; everything else is not.
 *
 * Queue depth and which integrations are configured describe how much traffic
 * the platform handles and which keys are set — free reconnaissance for anyone
 * who asks. They stay available for operators via the cron secret, which is the
 * credential the monitoring side already holds.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { secretsMatch } from "@/lib/crypto";

export const dynamic = "force-dynamic";

function isOperator(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export async function GET(req: NextRequest) {
  const started = Date.now();
  try {
    const [queued, dead] = await Promise.all([
      prisma.webhookEvent.count({ where: { status: { in: ["RECEIVED", "QUEUED", "PROCESSING"] } } }),
      prisma.webhookEvent.count({ where: { status: "DEAD_LETTER" } }),
    ]);

    if (!isOperator(req)) return NextResponse.json({ status: "ok" });

    return NextResponse.json({
      status: "ok",
      dbLatencyMs: Date.now() - started,
      queue: { depth: queued, dead },
      ai: process.env.ANTHROPIC_API_KEY ? "configured" : "missing",
      meta: process.env.META_APP_ID ? "configured" : "missing",
    });
  } catch (e) {
    return NextResponse.json({ status: "degraded", error: "database_unreachable" }, { status: 503 });
  }
}
