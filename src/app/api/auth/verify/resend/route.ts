/**
 * Re-send the verification email to the signed-in user's own address.
 *
 * Authenticated on purpose: an anonymous resend endpoint that takes an email
 * address is a way to make Leadra send mail to anyone.
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { issueVerification } from "@/lib/email-verification";
import { checkDurableLimit } from "@/lib/ratelimit";

export const POST = withAuth(async (req, ctx, correlationId) => {
  const durable = await checkDurableLimit(`user:${ctx.userId}`, "/api/auth/forgot");
  if (!durable.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "أرسلنا عدة رسائل بالفعل — تحقق من بريدك", correlationId } },
      { status: 429 },
    );
  }

  // Returns null when the address is already verified; nothing to do, and
  // saying so is fine because the caller is the account owner.
  const issued = await issueVerification(ctx.userId);
  return NextResponse.json({ ok: true, sent: issued !== null });
});
