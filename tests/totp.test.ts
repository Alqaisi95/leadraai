import { describe, it, expect } from "vitest";
import { generateSecret, verifyTotp, otpauthUrl } from "@/lib/totp";
import { createHmac } from "crypto";

// re-derive expected code the same way an authenticator app would
function expectedCode(secret: string, step: number): string {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

describe("TOTP (R1.3)", () => {
  it("secret is valid base32 of expected length", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
  });
  it("verifies current-window code and rejects garbage", () => {
    const s = generateSecret();
    const now = Math.floor(Date.now() / 30_000);
    expect(verifyTotp(s, expectedCode(s, now))).toBe(true);
    expect(verifyTotp(s, "000001")).toBe(false);
  });
  it("accepts ±1 window (clock drift)", () => {
    const s = generateSecret();
    const now = Math.floor(Date.now() / 30_000);
    expect(verifyTotp(s, expectedCode(s, now - 1))).toBe(true);
    expect(verifyTotp(s, expectedCode(s, now + 1))).toBe(true);
    expect(verifyTotp(s, expectedCode(s, now - 2))).toBe(false);
  });
  it("otpauth url encodes issuer", () => {
    expect(otpauthUrl("a@b.com", "ABC")).toContain("issuer=Leadra");
  });
});
