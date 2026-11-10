/** Consume an email-verification link. Public — the link arrives by email. */
import { NextRequest, NextResponse } from "next/server";
import { consumeVerification } from "@/lib/email-verification";
import { checkRateLimit } from "@/lib/ratelimit";

function tokenFrom(pathname: string) {
  return decodeURIComponent(pathname.split("/").at(-1)!);
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const rl = checkRateLimit(`verify:${ip ?? "unknown"}`, "/api/auth/verify");
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "محاولات كثيرة — انتظر قليلًا" } },
      { status: 429 },
    );
  }

  const result = await consumeVerification(tokenFrom(req.nextUrl.pathname));
  if (result.status === "invalid") {
    return NextResponse.json(
      { error: { code: "INVALID_TOKEN", message: "الرابط غير صالح أو منتهي الصلاحية" } },
      { status: 404 },
    );
  }
  // "already" is a success from the reader's point of view — their address is
  // confirmed, which is all they came here to find out.
  return NextResponse.json({ ok: true, alreadyVerified: result.status === "already" });
}
