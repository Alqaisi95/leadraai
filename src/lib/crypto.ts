/**
 * AES-256-GCM encryption for integration tokens.
 * Key from TOKEN_ENCRYPTION_KEY (32 bytes base64) — production: secrets manager.
 * Tokens are NEVER sent to the client and NEVER logged.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes base64");
  return buf;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64"), enc.toString("base64"), cipher.getAuthTag().toString("base64")].join(".");
}

export function decryptToken(stored: string): string {
  const [ivB64, dataB64, tagB64] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Constant-time comparison for secrets that arrive as strings — CSRF tokens,
 * cron bearer secrets. `===` on a secret leaks its prefix through timing, and
 * `timingSafeEqual` throws outright when the lengths differ, so the length
 * check has to come first and has to be the only thing that short-circuits.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
