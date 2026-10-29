import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("Token encryption (R1)", () => {
  it("round-trips and never stores plaintext", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/crypto");
    const token = "IGQVJXtest_secret_token_value_123";
    const enc = encryptToken(token);
    expect(enc).not.toContain(token);
    expect(enc.split(".").length).toBe(3); // iv.data.tag
    expect(decryptToken(enc)).toBe(token);
  });
  it("tampered ciphertext fails authentication", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/crypto");
    const enc = encryptToken("secret");
    const [iv, data, tag] = enc.split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptToken([iv, flipped.toString("base64"), tag].join("."))).toThrow();
  });
});
