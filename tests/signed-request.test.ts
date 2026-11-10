import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";

/**
 * Mirrors the parser in /api/data-deletion. Meta signs the payload half of
 * `sig.payload` with the app secret, both halves base64url. A forged or
 * re-signed request must not authorise deleting someone's data.
 */
function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: object, secret: string) {
  const encoded = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac("sha256", secret).update(encoded).digest());
  return `${sig}.${encoded}`;
}

function b64urlToBuffer(input: string) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function parse(signed: string, secret: string): { user_id?: string } | null {
  const [sigPart, payloadPart] = signed.split(".");
  if (!sigPart || !payloadPart) return null;
  const expected = createHmac("sha256", secret).update(payloadPart).digest();
  const provided = b64urlToBuffer(sigPart);
  if (provided.length !== expected.length || !provided.equals(expected)) return null;
  try {
    return JSON.parse(b64urlToBuffer(payloadPart).toString("utf8"));
  } catch {
    return null;
  }
}

const SECRET = "test_app_secret_value";

describe("Meta signed_request — بوابة حذف البيانات", () => {
  it("accepts a correctly signed request and extracts the user id", () => {
    const parsed = parse(sign({ user_id: "17841400000000", algorithm: "HMAC-SHA256" }, SECRET), SECRET);
    expect(parsed?.user_id).toBe("17841400000000");
  });

  it("rejects a payload signed with a different secret", () => {
    expect(parse(sign({ user_id: "victim" }, "attacker_secret"), SECRET)).toBeNull();
  });

  it("rejects a tampered payload that keeps the original signature", () => {
    const signed = sign({ user_id: "attacker" }, SECRET);
    const [sig] = signed.split(".");
    const swapped = b64url(Buffer.from(JSON.stringify({ user_id: "victim" })));
    expect(parse(`${sig}.${swapped}`, SECRET)).toBeNull();
  });

  it("rejects malformed input rather than throwing", () => {
    for (const bad of ["", ".", "onlyonepart", "a.b", "...."]) {
      expect(parse(bad, SECRET)).toBeNull();
    }
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const [, payload] = sign({ user_id: "x" }, SECRET).split(".");
    expect(parse(`${b64url(Buffer.from("short"))}.${payload}`, SECRET)).toBeNull();
  });
});
