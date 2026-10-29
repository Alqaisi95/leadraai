/**
 * Meta Webhook Gateway (requirements §4.3):
 *  GET  — verify token handshake
 *  POST — verify X-Hub-Signature-256, store raw event, ACK 200 immediately.
 * NO synchronous processing, NO AI calls here. The worker consumes the queue.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { cfEnv } from "@/lib/cf";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // 1. Signature verification — reject anything unsigned
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + createHmac("sha256", process.env.META_APP_SECRET!).update(rawBody).digest("hex");
  const valid =
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return new NextResponse("Invalid signature", { status: 401 });

  // 2. Store raw + ACK fast. Dedup via unique(provider, externalEventId).
  const payload = JSON.parse(rawBody);
  const entries: any[] = payload.entry ?? [];
  let stored = 0;

  for (const entry of entries) {
    for (const messaging of entry.messaging ?? []) {
      const eventId = messaging.message?.mid ?? `${entry.id}:${entry.time}:${messaging.timestamp}`;
      try {
        await prisma.webhookEvent.create({
          data: {
            provider: "INSTAGRAM",
            externalEventId: eventId,
            rawPayload: { entryId: entry.id, messaging },
            status: "QUEUED",
          },
        });
        stored++;
      } catch (e: any) {
        if (e?.code !== "P2002") throw e; // P2002 = duplicate → already received, ignore silently
      }
    }
  }

  // 3. Wake the consumer now instead of waiting for the next cron tick.
  //    The DB row is the source of truth; the queue message is only a signal,
  //    so a failed send just means the minute cron picks it up.
  if (stored > 0) {
    try {
      await cfEnv()?.WEBHOOK_QUEUE?.send({ stored, at: Date.now() });
    } catch (e) {
      console.error("queue_send_failed", String(e).slice(0, 200));
    }
  }

  return new NextResponse("EVENT_RECEIVED", { status: 200 });
}
