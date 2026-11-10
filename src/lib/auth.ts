/**
 * Authentication: credentials + hashed opaque session tokens.
 * MFA hooks are stubbed for Phase 1 (required for ORG_ADMIN before launch).
 */
import { createHash, randomBytes } from "crypto";
import { verifyTotp, openSecret } from "./totp";
import { consumeRecoveryCode, remainingRecoveryCodes } from "./mfa-recovery";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import type { TenantContext } from "./tenant";
import type { RoleKey } from "./rbac";

const SESSION_TTL_HOURS = 24 * 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MIN = 15;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export const SESSION_COOKIE = "leadra_session";
export const CSRF_COOKIE = "leadra_csrf";

export async function login(
  email: string,
  password: string,
  meta: { ip?: string; userAgent?: string; totp?: string },
) {
  const normalized = email.trim().toLowerCase();
  let usedRecoveryCode = false;

  // temporary lockout after repeated failures
  const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60_000);
  const recentFailures = await prisma.loginAttempt.count({
    where: { email: normalized, success: false, createdAt: { gte: windowStart } },
  });
  if (recentFailures >= MAX_FAILED_ATTEMPTS) {
    return { ok: false as const, error: "LOCKED", retryAfterMin: LOCKOUT_WINDOW_MIN };
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  const valid = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;

  await prisma.loginAttempt.create({
    data: { userId: user?.id, email: normalized, success: valid, ip: meta.ip },
  });

  if (!user || !valid) return { ok: false as const, error: "INVALID_CREDENTIALS" };

  // R1.3 — MFA enforcement
  //
  // A recovery code is accepted in place of a TOTP code. Without this, losing
  // the authenticator device locked the account permanently: a password reset
  // does not help, because the second factor is still demanded afterwards.
  //
  // The TOTP code is tried first, so the ordinary path costs no extra query.
  // A recovery code is only looked up once TOTP has failed, and spending one
  // is what proves possession — so it is consumed here, on a request that has
  // already presented the correct password.
  if (user.mfaEnabled) {
    if (!meta.totp) return { ok: false as const, error: "MFA_REQUIRED" };

    const secret = user.mfaSecret ? openSecret(user.mfaSecret) : null;
    const totpOk = !!secret && verifyTotp(secret, meta.totp);
    if (!totpOk) {
      const recovered = await consumeRecoveryCode(user.id, meta.totp);
      if (!recovered) return { ok: false as const, error: "MFA_INVALID" };
      usedRecoveryCode = true;
    }
  }

  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000),
    },
  });

  // Reported so the sign-in response can warn that a code was spent and say
  // how many are left — a silent recovery login is how someone ends up with
  // zero codes and no idea.
  const recoveryCodesRemaining = usedRecoveryCode ? await remainingRecoveryCodes(user.id) : undefined;

  return { ok: true as const, token, csrf, userId: user.id, usedRecoveryCode, recoveryCodesRemaining };
}

export async function revokeAllSessions(userId: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Resolve session token + org header into a TenantContext.
 * Every API route calls this first.
 */
export async function resolveContext(
  token: string | null,
  organizationId: string | null,
): Promise<TenantContext | null> {
  if (!token || !organizationId) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;

  if (session.user.isSuperAdmin) {
    return { organizationId, memberId: "platform", userId: session.userId, role: "SUPER_ADMIN" };
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: session.userId } },
  });
  if (!membership || membership.status !== "ACTIVE") return null;

  return {
    organizationId,
    memberId: membership.id,
    userId: session.userId,
    role: membership.role as RoleKey,
  };
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

/** Counterpart to hashPassword, so callers never reach for bcrypt directly. */
export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}
