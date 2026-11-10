/**
 * Request a password reset link. Public and unauthenticated by definition.
 *
 * This endpoint always answers 200 with the same body. Reporting "no such
 * account" would turn it into a free user-enumeration oracle against a public
 * URL — anyone could test an email list and learn who has a Leadra account.
 * The cost of that guarantee is that a typo looks identical to success, which
 * is why the page tells the reader to check the address if nothing arrives.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { issueReset } from "@/lib/password-reset";
import { checkRateLimit, checkDurableLimit } from "@/lib/ratelimit";
import { sendEmail } from "@/lib/email";
import { captureError } from "@/lib/monitoring";

const schema = z.object({ email: z.string().email() });

/** Identical for every outcome — see the note above. */
const ACCEPTED = {
  ok: true,
  message: "إن كان هذا البريد مسجّلًا فستصلك رسالة بخطوات إعادة التعيين خلال دقائق.",
};

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  // Limited by IP *and* by address below, because one attacker with one IP
  // spraying many addresses and many IPs hitting one address are different
  // abuses and neither limit catches the other.
  const rl = checkRateLimit(`forgot-ip:${ip ?? "unknown"}`, "/api/auth/forgot");
  const durable = await checkDurableLimit(`ip:${ip ?? "unknown"}`, "/api/auth/forgot");
  // Still ACCEPTED — a 429 here would tell the caller their traffic is being
  // measured, and the whole endpoint is built to say nothing at all.
  if (!rl.ok || !durable.ok) return NextResponse.json(ACCEPTED);

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json(ACCEPTED);

  const email = body.data.email.trim().toLowerCase();
  const perAddress = checkRateLimit(`forgot-email:${email}`, "/api/auth/forgot");
  if (!perAddress.ok) return NextResponse.json(ACCEPTED);

  try {
    const reset = await issueReset(email, ip);
    if (reset) {
      const sent = await sendEmail(
        reset.email,
        "إعادة تعيين كلمة المرور — ليدرا",
        `مرحبًا ${reset.fullName},\n\n` +
          `وصلنا طلب لإعادة تعيين كلمة مرور حسابك في ليدرا.\n\n` +
          `${reset.url}\n\n` +
          `الرابط صالح لساعة واحدة ويُستخدم مرة واحدة.\n` +
          `إن لم تطلب هذا، تجاهل الرسالة — كلمة مرورك لم تتغير.\n`,
      );

      // Without SMTP the link would vanish silently and the operator would think
      // the feature is broken. Log it (server-side only) so a self-hosted or
      // half-configured install still has a way through.
      if (!sent) {
        console.warn(
          JSON.stringify({ level: "warn", message: "password_reset_email_not_sent", url: reset.url }),
        );
      }
    }
  } catch (e) {
    // A failure here must not change the response shape, or the error itself
    // becomes the oracle this endpoint exists to avoid.
    captureError(e, { route: "/api/auth/forgot" });
  }

  return NextResponse.json(ACCEPTED);
}
