/**
 * Check and consume a password reset link. Public — the whole point is that the
 * caller cannot sign in.
 *
 * GET reports only whether the token is still usable, so the page can show
 * "this link has expired" instead of failing after the person types a new
 * password twice. It reveals nothing about whose token it is.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { consumeReset, resetIsValid } from "@/lib/password-reset";
import { checkRateLimit, checkDurableLimit } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";

function tokenFrom(pathname: string) {
  return decodeURIComponent(pathname.split("/").at(-1)!);
}

export async function GET(req: NextRequest) {
  const valid = await resetIsValid(tokenFrom(req.nextUrl.pathname));
  return NextResponse.json({ valid });
}

const schema = z.object({ password: z.string().min(10).max(200) });

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  // The token is 32 random bytes, but the endpoint is still public: rate limit
  // so it cannot be hammered.
  const rl = checkRateLimit(`reset:${ip ?? "unknown"}`, "/api/auth/reset");
  const durable = await checkDurableLimit(`ip:${ip ?? "unknown"}`, "/api/auth/reset");
  if (!rl.ok || !durable.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "محاولات كثيرة — انتظر قليلًا", correlationId } },
      { status: 429 },
    );
  }

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "كلمة المرور ١٠ أحرف على الأقل", correlationId } },
      { status: 422 },
    );
  }

  const result = await consumeReset(tokenFrom(req.nextUrl.pathname), body.data.password);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_RESET",
          message: "الرابط غير صالح أو منتهي الصلاحية — اطلب رابطًا جديدًا",
          correlationId,
        },
      },
      { status: 404 },
    );
  }

  await audit({
    actorUserId: result.userId,
    action: "auth.password_reset",
    entityType: "User",
    entityId: result.userId,
    ip,
    correlationId,
  });

  // Deliberately not signing the person in. Every session was just revoked, and
  // making them use the new password once proves it is what they think it is.
  return NextResponse.json({ ok: true });
}
