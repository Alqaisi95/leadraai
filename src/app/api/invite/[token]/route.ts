/**
 * Public invitation endpoints — no session required by definition: the whole
 * point is that the invitee has no account yet.
 *
 * Every failure returns the same generic message so the token cannot be probed
 * to learn whether an invitation exists.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { acceptInvite, previewInvite } from "@/lib/invitations";
import { hashPassword, login, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth";
import { checkRateLimit } from "@/lib/ratelimit";

function tokenFrom(pathname: string) {
  return decodeURIComponent(pathname.split("/").at(-1)!);
}

const invalid = (correlationId: string) =>
  NextResponse.json(
    { error: { code: "INVALID_INVITE", message: "الدعوة غير صالحة أو منتهية الصلاحية", correlationId } },
    { status: 404 },
  );

export async function GET(req: NextRequest) {
  const correlationId = randomUUID();
  const preview = await previewInvite(tokenFrom(req.nextUrl.pathname));
  if (!preview) return invalid(correlationId);

  // never echo the memberId back to an unauthenticated caller
  return NextResponse.json({
    organizationName: preview.organizationName,
    email: preview.email,
    fullName: preview.fullName,
    role: preview.role,
    needsPassword: !preview.hasAccount,
  });
}

const schema = z.object({ password: z.string().min(10).max(200).optional() });

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  const rl = checkRateLimit(`invite:${ip ?? "unknown"}`, "/api/invite");
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "محاولات كثيرة — انتظر قليلًا", correlationId } },
      { status: 429 },
    );
  }

  const token = tokenFrom(req.nextUrl.pathname);
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "كلمة المرور ١٠ أحرف على الأقل", correlationId } },
      { status: 422 },
    );
  }

  const preview = await previewInvite(token);
  if (!preview) return invalid(correlationId);
  if (preview.hasAccount === false && !body.data.password) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "كلمة المرور مطلوبة لإنشاء حسابك", correlationId } },
      { status: 422 },
    );
  }

  const passwordHash = body.data.password ? await hashPassword(body.data.password) : undefined;
  const accepted = await acceptInvite(token, passwordHash);
  if (!accepted) return invalid(correlationId);

  // sign the new member in straight away — an accepted invite that dumps you on
  // a login screen is a needless extra step
  if (body.data.password) {
    const session = await login(accepted.email, body.data.password, {
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    if (session.ok) {
      const secure = process.env.NODE_ENV === "production";
      const maxAge = 7 * 86400;
      const res = NextResponse.json({ ok: true, signedIn: true, organizationId: accepted.organizationId });
      res.cookies.set(SESSION_COOKIE, session.token, {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge,
      });
      res.cookies.set(CSRF_COOKIE, session.csrf, {
        httpOnly: false,
        secure,
        sameSite: "lax",
        path: "/",
        maxAge,
      });
      return res;
    }
  }

  return NextResponse.json({ ok: true, signedIn: false, organizationId: accepted.organizationId });
}
