/**
 * TOTP (RFC 6238) — native implementation, no dependencies. (R1.3)
 * SHA-1, 6 digits, 30s step, ±1 window tolerance.
 */
import { createHmac, randomBytes } from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(): string {
  const bytes = randomBytes(20);
  let bits = "", out = "";
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
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
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
