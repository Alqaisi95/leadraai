/**
 * Meta Data Deletion Callback (required for App Review).
 *
 * Meta POSTs a `signed_request` (base64url signature "." base64url payload,
 * HMAC-SHA256 over the payload with the app secret). We verify it, erase every
 * trace of that Instagram user, and return a status URL + confirmation code so
 * the person can check the request — the shape Meta expects.
 *
 * GET returns the status of a previously issued code.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import { captureError } from "@/lib/monitoring";

function b64urlToBuffer(input: string) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function parseSignedRequest(signed: string, secret: string): { user_id?: string } | null {
  const [sigPart, payloadPart] = signed.split(".");
  if (!sigPart || !payloadPart) return null;

  const expected = createHmac("sha256", secret).update(payloadPart).digest();
  const provided = b64urlToBuffer(sigPart);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    return JSON.parse(b64urlToBuffer(payloadPart).toString("utf8"));
  } catch {
    return null;
  }
}

/** Erase everything tied to one Instagram user id, across every tenant. */
async function eraseInstagramUser(externalUserId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { customerExternalId: externalUserId },
    select: { id: true, lead: { select: { id: true } } },
  });

  const leadIds = conversations.map((c) => c.lead?.id).filter(Boolean) as string[];
  const viaIdentifier = await prisma.leadIdentifier.findMany({
    where: { kind: "ig_user_id", value: externalUserId },
    select: { leadId: true },
  });
  const allLeadIds = [...new Set([...leadIds, ...viaIdentifier.map((i) => i.leadId)])];

  // leads cascade to notes/tasks/appointments/identifiers/score events;
  // conversations cascade to messages.
  await prisma.$transaction([
    prisma.lead.deleteMany({ where: { id: { in: allLeadIds } } }),
    prisma.conversation.deleteMany({ where: { customerExternalId: externalUserId } }),
    prisma.webhookEvent.deleteMany({
      where: { rawPayload: { path: ["messaging", "sender", "id"], equals: externalUserId } },
    }),
  ]);

  return { conversations: conversations.length, leads: allLeadIds.length };
}

export async function POST(req: NextRequest) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");
  if (typeof signed !== "string") {
    return NextResponse.json({ error: "signed_request required" }, { status: 400 });
  }

  const payload = parseSignedRequest(signed, secret);
  if (!payload?.user_id) {
    return NextResponse.json({ error: "invalid signed_request" }, { status: 401 });
  }

  // the code is derived, not stored: it identifies the request without keeping
  // a record of a person who just asked to be forgotten
  const confirmationCode = createHmac("sha256", secret)
    .update(`deletion:${payload.user_id}`)
    .digest("hex")
    .slice(0, 16);

  try {
    const removed = await eraseInstagramUser(payload.user_id);
    console.info(JSON.stringify({ event: "data_deletion", confirmationCode, ...removed }));
  } catch (e) {
    captureError(e, { route: "/api/data-deletion", confirmationCode });
    return NextResponse.json({ error: "deletion_failed" }, { status: 500 });
  }

  const base = process.env.APP_URL ?? new URL(req.url).origin;
  return NextResponse.json({
    url: `${base}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}
