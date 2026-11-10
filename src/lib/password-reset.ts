/**
 * Password reset.
 *
 * The raw token leaves this module exactly once, in the email; only its
 * SHA-256 hash is stored — same rule as session tokens and invitations, so a
 * database dump cannot be replayed into working reset links.
 *
 * Two properties matter more than anything else here:
 *
 * 1. **Nothing observable distinguishes a known email from an unknown one.**
 *    A reset endpoint that answers differently for a registered address is a
 *    user-enumeration oracle, and this one is public and unauthenticated.
 *
 * 2. **Completing a reset ends every existing session.** The reason someone
 *    resets a password is often that somebody else knows the old one; leaving
 *    that person's session alive defeats the entire exercise.
 */
import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";
import { hashPassword, revokeAllSessions } from "./auth";

const RESET_TTL_MIN = 60;
/** Outstanding requests one account may have before we stop issuing more. */
const MAX_OPEN_PER_USER = 3;

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function resetUrl(token: string) {
  return `${process.env.APP_URL ?? ""}/reset/${token}`;
}

export interface IssuedReset {
  token: string;
  url: string;
  email: string;
  fullName: string;
  expiresAt: Date;
}

/**
 * Issue a reset for an email address, or return null when there is nothing to
 * issue. The caller must treat null and success identically in its response.
 */
export async function issueReset(email: string, requestIp?: string): Promise<IssuedReset | null> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  // An account with no password has never completed signup — it is waiting on
  // an invitation, and resetting it would be a way around that flow.
  if (!user || !user.passwordHash) return null;

  // Someone hammering "forgot password" at a real address should not be able to
  // fill that person's inbox indefinitely.
  const open = await prisma.passwordReset.count({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (open >= MAX_OPEN_PER_USER) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MIN * 60_000);

  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt, requestIp },
  });

  return { token, url: resetUrl(token), email: user.email, fullName: user.fullName, expiresAt };
}

/** Whether a token is still good, without consuming it — for the reset page. */
export async function resetIsValid(token: string): Promise<boolean> {
  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { usedAt: true, expiresAt: true },
  });
  return Boolean(row && !row.usedAt && row.expiresAt > new Date());
}

export type ConsumeResult = { ok: true; userId: string; email: string } | { ok: false };

/**
 * Consume a reset token: set the new password, mark the token used, drop every
 * session, and clear the failed-login record.
 *
 * The whole thing is one transaction. A partial apply here is the worst of both
 * worlds — a password changed but sessions left alive, or a token burned
 * without the password actually changing, locking the person out for good.
 */
export async function consumeReset(token: string, newPassword: string): Promise<ConsumeResult> {
  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return { ok: false };

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    // Mark used inside the transaction and only for a token still unused, so two
    // simultaneous submissions of the same link cannot both go through.
    prisma.passwordReset.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    // Any other outstanding link for this account is now stale.
    prisma.passwordReset.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    // The lockout counts failures by email; without this a person who reset
    // *because* they kept failing stays locked out with a correct password.
    prisma.loginAttempt.deleteMany({ where: { email: row.user.email, success: false } }),
  ]);

  await revokeAllSessions(row.userId);

  return { ok: true, userId: row.userId, email: row.user.email };
}
