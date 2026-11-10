import { describe, it, expect, beforeAll } from "vitest";
import { generateSecret, verifyTotp, otpauthUrl } from "@/lib/totp";
import { createHmac, randomBytes } from "crypto";

// re-derive expected code the same way an authenticator app would
function expectedCode(secret: string, step: number): string {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
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

describe("MFA secret at rest", () => {
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("never stores the secret in a readable form", async () => {
    const { generateSecret, sealSecret } = await import("@/lib/totp");
    const secret = generateSecret();

    const sealed = sealSecret(secret);

    // The schema claimed "encrypted at rest" from the first migration while
    // writing the value verbatim. A reader of the table could mint valid codes
    // for every MFA account, forever.
    expect(sealed).not.toContain(secret);
    expect(sealed.split(".")).toHaveLength(3); // iv.data.tag
  });

  it("round-trips, and the recovered secret still verifies codes", async () => {
    const { generateSecret, sealSecret, openSecret, verifyTotp } = await import("@/lib/totp");
    const secret = generateSecret();

    const recovered = openSecret(sealSecret(secret));

    expect(recovered).toBe(secret);
    // The point of the round trip: a sign-in still works after it.
    expect(verifyTotp(recovered!, "000000")).toBe(verifyTotp(secret, "000000"));
  });

  it("still reads a secret written before encryption existed", async () => {
    const { generateSecret, openSecret } = await import("@/lib/totp");
    const legacy = generateSecret(); // bare base32, as the column used to hold

    // No backfill migration, and no window where nobody can sign in.
    expect(openSecret(legacy)).toBe(legacy);
  });

  it("tells the two forms apart by shape alone", async () => {
    const { generateSecret, sealSecret } = await import("@/lib/totp");

    // A base32 secret can never contain a dot; the sealed form always does.
    // That is what makes the in-place migration unambiguous.
    for (let i = 0; i < 25; i++) expect(generateSecret()).not.toContain(".");
    expect(sealSecret(generateSecret())).toContain(".");
  });

  it("fails closed on an unreadable secret", async () => {
    const { openSecret } = await import("@/lib/totp");

    // Wrong key or a corrupted row. Returning null makes the caller treat it
    // as "no valid second factor"; the alternative would be treating an
    // unreadable secret as a passed check.
    expect(openSecret("bm90.YSByZWFs.c2VhbA==")).toBeNull();
  });
});
