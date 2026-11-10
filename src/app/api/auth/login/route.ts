import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkRateLimit, checkDurableLimit } from "@/lib/ratelimit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  totp: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(`ip:${ip}`, "/api/auth/login");
  // The per-account lockout in login() already bounds guessing at one address.
  // This bounds one source spraying across many addresses, and unlike the
  // in-memory check it holds across instances.
  const durable = await checkDurableLimit(`ip:${ip}`, "/api/auth/login");
  if (!rl.ok || !durable.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests" } },
      { status: 429 },
    );
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid format" } }, { status: 422 });
  }

  const result = await login(body.data.email, body.data.password, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
    totp: body.data.totp,
  });

  if (!result.ok) {
    const map: Record<string, [number, string]> = {
      LOCKED: [429, "Too many attempts. Try again in 15 minutes."],
      MFA_REQUIRED: [401, "TOTP code required"],
      // Wording covers both factors now: a failure here may mean a wrong TOTP
      // code or a wrong/spent recovery code, and the response must not reveal
      // which — that would tell an attacker whether a code they hold is real.
      MFA_INVALID: [401, "Invalid TOTP or recovery code"],
      INVALID_CREDENTIALS: [401, "Invalid email or password"],
    };
    const [status, message] = map[result.error] ?? [401, "Login failed"];
    return NextResponse.json({ error: { code: result.error, message } }, { status });
  }

  await audit({
    actorUserId: result.userId,
    action: result.usedRecoveryCode ? "auth.login_recovery_code" : "auth.login",
    ip,
  });

  // R1.2 — httpOnly session cookie + readable CSRF cookie (double-submit)
  // A recovery login is reported so the UI can say a code was spent and how
  // many remain. Silence here is how someone reaches zero codes without ever
  // noticing, which puts them back in the lockout this feature just ended.
  const res = NextResponse.json(
    result.usedRecoveryCode
      ? { ok: true, usedRecoveryCode: true, recoveryCodesRemaining: result.recoveryCodesRemaining }
      : { ok: true },
  );
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
  res.cookies.set(CSRF_COOKIE, result.csrf, {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
  return res;
}
