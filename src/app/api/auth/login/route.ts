import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login, SESSION_COOKIE, CSRF_COOKIE } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/ratelimit";

const schema = z.object({ email: z.string().email(), password: z.string().min(8), totp: z.string().optional() });

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const rl = await checkRateLimit(`ip:${ip}`, "/api/auth/login");
  if (!rl.ok) return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });

  const body = schema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid format" } }, { status: 422 });
  }

  const result = await login(body.data.email, body.data.password, {
    ip, userAgent: req.headers.get("user-agent") ?? undefined, totp: body.data.totp,
  });

  if (!result.ok) {
    const map: Record<string, [number, string]> = {
      LOCKED: [429, "Too many attempts. Try again in 15 minutes."],
      MFA_REQUIRED: [401, "TOTP code required"],
      MFA_INVALID: [401, "Invalid TOTP code"],
      INVALID_CREDENTIALS: [401, "Invalid email or password"],
    };
    const [status, message] = map[result.error] ?? [401, "Login failed"];
    return NextResponse.json({ error: { code: result.error, message } }, { status });
  }

  await audit({ actorUserId: result.userId, action: "auth.login", ip });

  // R1.2 — httpOnly session cookie + readable CSRF cookie (double-submit)
  const res = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, result.token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
  res.cookies.set(CSRF_COOKIE, result.csrf, { httpOnly: false, secure, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
  return res;
}
