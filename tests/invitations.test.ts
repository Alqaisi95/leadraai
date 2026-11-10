import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";
import { hashInviteToken, inviteUrl } from "@/lib/invitations";

/**
 * The invitation token is a bearer credential: whoever holds it joins the
 * organization. These pin the properties that keep a database dump from being
 * replayed into working invitations.
 */
beforeEach(() => {
  process.env.APP_URL = "https://app.test";
});

describe("hashInviteToken — تخزين رمز الدعوة", () => {
  it("stores a hash, never anything the raw token can be read back from", () => {
    const token = "s3cret-invite-token";
    const stored = hashInviteToken(token);
    expect(stored).not.toBe(token);
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic, so lookup by hash finds the invitation", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
  });

  it("separates tokens that differ by a single character", () => {
    expect(hashInviteToken("token-a")).not.toBe(hashInviteToken("token-b"));
  });

  it("does not collapse whitespace or case — a near-miss must not authenticate", () => {
    expect(hashInviteToken("Token")).not.toBe(hashInviteToken("token"));
    expect(hashInviteToken("token ")).not.toBe(hashInviteToken("token"));
  });
});

describe("inviteUrl — رابط الدعوة", () => {
  it("points at the public accept page on the configured host", () => {
    expect(inviteUrl("abc123")).toBe("https://app.test/invite/abc123");
  });

  it("does not throw when APP_URL is unset — the admin can still copy a path", () => {
    delete process.env.APP_URL;
    expect(() => inviteUrl("abc")).not.toThrow();
    expect(inviteUrl("abc")).toContain("/invite/abc");
  });
});
