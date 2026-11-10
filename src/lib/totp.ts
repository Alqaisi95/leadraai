/**
 * TOTP (RFC 6238) — native implementation, no dependencies. (R1.3)
 * SHA-1, 6 digits, 30s step, ±1 window tolerance.
 */
import { createHmac, randomBytes } from "crypto";
import { encryptToken, decryptToken } from "./crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(): string {
  const bytes = randomBytes(20);
  let bits = "",
    out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = "";
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const v = B32.indexOf(c);
    if (v === -1) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, windowSteps = 1): boolean {
  const step = Math.floor(Date.now() / 30_000);
  const clean = code.replace(/\s/g, "");
  for (let w = -windowSteps; w <= windowSteps; w++) {
    if (hotp(secret, step + w) === clean) return true;
  }
  return false;
}

export function otpauthUrl(email: string, secret: string): string {
  return `otpauth://totp/Leadra:${encodeURIComponent(email)}?secret=${secret}&issuer=Leadra%20AI&digits=6&period=30`;
}

/**
 * Encrypting the secret at rest.
 *
 * The schema has described mfaSecret as "encrypted at rest" since the first
 * migration, and it was not: the value went into the column verbatim. That
 * made a database read enough to mint valid TOTP codes for every account with
 * MFA on, forever — a second factor that a reader of the table already has is
 * not a second factor.
 *
 * The two forms are told apart by shape rather than a flag column. A TOTP
 * secret is base32 (A–Z, 2–7) and can never contain a dot; the sealed form is
 * `iv.data.tag`. So rows written before this change keep working and are
 * re-sealed the next time the secret is set, with no backfill migration and no
 * window where nobody can log in.
 */
export function sealSecret(plain: string): string {
  return encryptToken(plain);
}

/**
 * Read a stored secret. Returns null if it cannot be read at all, which the
 * callers treat as "no valid second factor" rather than crashing a sign-in.
 */
export function openSecret(stored: string): string | null {
  if (!stored.includes(".")) return stored; // written before encryption existed
  try {
    return decryptToken(stored);
  } catch {
    // Wrong key, or a corrupted row. Failing closed is right: the alternative
    // is treating an unreadable secret as a passed check.
    return null;
  }
}
