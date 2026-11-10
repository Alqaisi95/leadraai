/**
 * Email verification.
 *
 * The design question here is not how to verify an address — it is where to put
 * the wall. Blocking sign-in until the link is clicked is the common answer and
 * the wrong one: it stops people from reaching the product they just signed up
 * for, over an email that may be delayed, filtered, or mistyped, and it costs
 * activation for no security benefit.
 *
 * So an unverified owner can sign in and look around. What they cannot do is
 * anything that reaches outside their own account:
 *
 *  - **Connect Instagram.** Verification is what ties a Meta integration to a
 *    real, reachable owner.
 *  - **Invite members.** Otherwise anyone could send Leadra invitations from an
 *    address they do not control.
 *
 * The gate sits at the value, not at the door.
 */
import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";
import { sendEmail } from "./email";

const VERIFY_TTL_HOURS = 48;

export function hashVerificationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function verificationUrl(token: string) {
  return `${process.env.APP_URL ?? ""}/verify/${token}`;
}

/**
 * Create a verification token and mail it. Returns the raw token so callers can
 * log it when SMTP is not configured; it is never persisted.
 */
export async function issueVerification(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, fullName: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) return null;

  const token = randomBytes(32).toString("base64url");

  // A new link supersedes the old ones rather than adding to them, so an inbox
  // with three Leadra emails in it does not have two dead links in it.
  await prisma.$transaction([
    prisma.emailVerification.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.emailVerification.create({
      data: {
        userId,
        tokenHash: hashVerificationToken(token),
        expiresAt: new Date(Date.now() + VERIFY_TTL_HOURS * 3600_000),
      },
    }),
  ]);

  const url = verificationUrl(token);
  const sent = await sendEmail(
    user.email,
    "أكّد بريدك الإلكتروني — ليدرا",
    `مرحبًا ${user.fullName},\n\n` +
      `أكّد بريدك لتفعيل ربط Instagram ودعوة أعضاء فريقك:\n\n` +
      `${url}\n\n` +
      `الرابط صالح لمدة ٤٨ ساعة.\n`,
  );

  // Without SMTP the link would vanish and the account could never be verified.
  if (!sent) {
    console.warn(JSON.stringify({ level: "warn", message: "verification_email_not_sent", url }));
  }

  return token;
}

export type VerifyResult =
  { status: "verified"; email: string } | { status: "already" } | { status: "invalid" };

export async function consumeVerification(token: string): Promise<VerifyResult> {
  const row = await prisma.emailVerification.findUnique({
    where: { tokenHash: hashVerificationToken(token) },
    include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
  });
  if (!row) return { status: "invalid" };

  // Clicking a link twice — or the mail client prefetching it — must read as
  // success, not as an error the person has to make sense of.
  if (row.user.emailVerifiedAt) return { status: "already" };
  if (row.usedAt || row.expiresAt <= new Date()) return { status: "invalid" };

  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerification.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  return { status: "verified", email: row.user.email };
}

export class EmailNotVerifiedError extends Error {
  constructor(action: string) {
    super(`أكّد بريدك الإلكتروني أولًا — ${action} يتطلب بريدًا مؤكَّدًا.`);
  }
}

/**
 * Guard for the two actions that reach beyond the account itself.
 *
 * A single question, with no cutoff date anywhere in the application: accounts
 * that predate this feature were stamped verified by the backfill migration, so
 * a null column now means exactly one thing.
 */
export async function requireVerifiedEmail(userId: string, action: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true },
  });
  if (!user?.emailVerifiedAt) throw new EmailNotVerifiedError(action);
}
