import { describe, it, expect } from "vitest";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Mirrors the gate in /api/webhooks/meta. Meta signs the raw body with the app
 * secret; anything that fails must return 401, and — just as important — must
 * not *throw*, because an uncaught error becomes a 500 and Meta then retries
 * the same delivery in a loop.
 */
function signatureMatches(received: string, secret: string, body: string): boolean {
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(body).digest("hex"), "utf8");
  const provided = Buffer.from(received, "utf8");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

const SECRET = "app_secret_value";
const BODY = '{"object":"instagram","entry":[{"id":"1","time":2,"messaging":[]}]}';
const sign = (body: string, secret = SECRET) =>
  "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("توقيع Webhook — البوابة", () => {
  it("accepts a correctly signed body", () => {
    expect(signatureMatches(sign(BODY), SECRET, BODY)).toBe(true);
  });

  it("rejects a body signed with a different secret", () => {
    expect(signatureMatches(sign(BODY, "attacker"), SECRET, BODY)).toBe(false);
  });

  it("rejects a body altered after signing", () => {
    const sig = sign(BODY);
    expect(signatureMatches(sig, SECRET, BODY.replace("instagram", "page"))).toBe(false);
  });

  it("rejects a missing header without throwing", () => {
    expect(() => signatureMatches("", SECRET, BODY)).not.toThrow();
    expect(signatureMatches("", SECRET, BODY)).toBe(false);
  });

  it("rejects a multibyte header without throwing", () => {
    // same character count as a real signature, different byte length —
    // timingSafeEqual would throw on this if lengths were compared as strings
    const sameCharCount = "ط".repeat(sign(BODY).length);
    expect(() => signatureMatches(sameCharCount, SECRET, BODY)).not.toThrow();
    expect(signatureMatches(sameCharCount, SECRET, BODY)).toBe(false);
  });

  it("rejects a signature missing its algorithm prefix", () => {
    const bare = sign(BODY).replace("sha256=", "");
    expect(signatureMatches(bare, SECRET, BODY)).toBe(false);
  });

  it("is sensitive to whitespace — the signature covers the exact bytes", () => {
    expect(signatureMatches(sign(BODY), SECRET, BODY + " ")).toBe(false);
  });
});

describe("تمييز نوع الحدث", () => {
  // Meta delivers every subscribed product to the same callback URL; only the
  // `object` field distinguishes them. Filing a Page event as Instagram would
  // send the worker looking for an integration by Page id, failing five times
  // before dead-lettering.
  const isOurs = (payload: any) => payload.object === "instagram";

  it("accepts instagram payloads", () => {
    expect(isOurs({ object: "instagram", entry: [] })).toBe(true);
  });

  it("ignores page and threads payloads delivered to the same URL", () => {
    expect(isOurs({ object: "page", entry: [] })).toBe(false);
    expect(isOurs({ object: "threads", entry: [] })).toBe(false);
  });

  it("ignores a payload with no object field at all", () => {
    expect(isOurs({ entry: [] })).toBe(false);
  });
});
