/**
 * Meta Webhook Gateway (requirements §4.3):
 *  GET  — verify token handshake
 *  POST — verify X-Hub-Signature-256, store raw event, ACK 200 immediately.
 * NO synchronous processing, NO AI calls here. The worker consumes the queue.
 *
 * Meta delivers every product an app subscribes to — Instagram, Page, Threads —
 * to the *same* callback URL, distinguished only by the top-level `object`
 * field. Meta's own sample splits them across separate routes; we get one URL,
 * so the discrimination has to happen here.
 *
 * Any uncaught throw here becomes a 500, which Meta retries — so every failure
 * mode below returns a deliberate status instead.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { captureError } from "@/lib/monitoring";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return new NextResponse("Not configured", { status: 503 });

  if (mode === "subscribe" && token === expected) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** Constant-time compare that cannot throw on a malformed header. */
function signatureMatches(received: string, secret: string, body: string): boolean {
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"), "utf8");
  const provided = Buffer.from(received, "utf8");
  // timingSafeEqual throws on a length mismatch — a multibyte header could
  // otherwise match on character count and blow up instead of returning 401
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return new NextResponse("Not configured", { status: 503 });

  const rawBody = await req.text();

  // 1. Signature verification — reject anything unsigned
  if (!signatureMatches(req.headers.get("x-hub-signature-256") ?? "", secret, rawBody)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // 2. Parse defensively: a throw here would 500 and trigger Meta's retry loop
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Malformed payload", { status: 400 });
  }

  // 3. Only Instagram messaging is ours. Acknowledge anything else so Meta
  //    stops retrying, but never file it as an Instagram event — the worker
  //    would look up an integration by a Page id and dead-letter after five
  //    attempts.
  if (payload.object !== "instagram") {
    return new NextResponse("EVENT_RECEIVED", { status: 200 });
  }

  try {
    for (const entry of (payload.entry ?? []) as any[]) {
      // `changes` carries comments and mentions; we subscribe to DMs only, so
      // those are acknowledged and dropped rather than queued.
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
        } catch (e: any) {
          if (e?.code !== "P2002") throw e; // P2002 = duplicate → already received
        }
      }
    }
  } catch (e) {
    // Persisting failed (database down). Return 500 *on purpose*: Meta will
    // redeliver, which is what we want — the alternative is a lost message.
    captureError(e, { route: "/api/webhooks/meta" });
    return new NextResponse("Storage failure", { status: 500 });
  }

  return new NextResponse("EVENT_RECEIVED", { status: 200 });
}
