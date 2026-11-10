/**
 * MFA recovery codes.
 *
 * Before this existed, losing the authenticator device locked an account
 * permanently. `login()` demands a TOTP code once `mfaEnabled` is set, a
 * password reset does not help because the second factor is still required
 * afterwards, and there was no disable path. The only remedy was an operator
 * editing the database by hand.
 *
 * The design follows the same rules as the password-reset tokens:
 *
 *   * **Hashes only.** A database read must not yield a working second factor,
 *     which is the entire point of having one. The plaintext codes exist
 *     exactly once, in the response that generates them, and cannot be
 *     recovered afterwards — only replaced.
 *
 *   * **Single use, enforced by the database.** The unique index on
 *     (userId, codeHash) and the `usedAt` stamp mean a code cannot be spent
 *     twice even if two requests arrive together.
 *
 *   * **Constant-time comparison.** Codes are looked up by hash rather than
 *     compared one by one in a loop whose duration would leak how many codes
 *     remain.
 *
 *   * **Generating replaces, never appends.** A user who regenerates expects
 *     the old printout to stop working; leaving old hashes behind would mean a
 *     sheet of paper thrown away last year still opens the account.
 */
import { createHash, randomInt } from "crypto";
import { prisma } from "./db";

/** Ten is the usual number: enough to keep a few spares, few enough to print. */
export const CODE_COUNT = 10;

/**
 * Unambiguous alphabet: no O/0, I/1/l. These get written on paper and typed
 * back under stress, and a code that reads wrong is a code that locks someone
 * out — the failure this feature exists to prevent.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP = 5;
const GROUPS = 2;

function hashCode(userId: string, code: string): string {
  // Salted with the user id so identical codes for two users do not collide,
  // and so a hash lifted from one row cannot be replayed against another.
  return createHash("sha256")
    .update(`${userId}:${normalize(code)}`)
    .digest("hex");
}

/** Accepts what a human types: spacing, dashes and case are all forgiven. */
export function normalize(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function generateCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let out = "";
    // randomInt is rejection-sampled, so the alphabet stays uniform. A plain
    // `% ALPHABET.length` over random bytes would bias the early letters.
    for (let i = 0; i < GROUP; i++) out += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(out);
  }
  return groups.join("-");
}

/**
 * Issue a fresh set, replacing any existing one.
 *
 * Returns the plaintext codes. This is the only time they exist — show them
 * once and store nothing.
 */
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const codes: string[] = [];
  const seen = new Set<string>();
  while (codes.length < CODE_COUNT) {
    const code = generateCode();
    // A duplicate within one set would violate the unique index and, worse,
    // silently leave the user with fewer codes than the screen claims.
    if (seen.has(normalize(code))) continue;
    seen.add(normalize(code));
    codes.push(code);
  }

  await prisma.$transaction([
    prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    prisma.mfaRecoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashCode(userId, code) })),
    }),
  ]);

  return codes;
}

/**
 * Spend one code. Returns true only if it was valid and unused.
 *
 * The update is conditional on `usedAt` still being null, so two concurrent
 * attempts with the same code cannot both succeed.
 */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const normalized = normalize(code);
  if (!normalized) return false;

  const { count } = await prisma.mfaRecoveryCode.updateMany({
    where: { userId, codeHash: hashCode(userId, normalized), usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/** How many codes are left, for the warning the settings screen shows. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  return prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } });
}

/** Discard every code, used or not. Called when MFA is turned off. */
export async function clearRecoveryCodes(userId: string): Promise<void> {
  await prisma.mfaRecoveryCode.deleteMany({ where: { userId } });
}
