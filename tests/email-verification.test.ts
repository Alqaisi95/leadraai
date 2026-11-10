/**
 * Email verification — where the wall is, and that it holds.
 *
 * The behaviour worth pinning down is not "a token works once". It is that an
 * unverified account can still use the product, that the two outward-facing
 * actions are refused, and that a null column is the only thing that decides.
 */
import { describe, it, expect, beforeAll } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — email verification must not be skipped");
}

describe.skipIf(!HAS_DB)("Email verification", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let lib: typeof import("@/lib/email-verification");

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    lib = await import("@/lib/email-verification");
  });

  async function makeUser(suffix: string) {
    return prisma.user.create({
      data: {
        email: `verify-${suffix}-${Date.now()}@example.test`,
        fullName: "اختبار",
        passwordHash: "x",
      },
    });
  }

  it("stores only the hash", async () => {
    const user = await makeUser("hash");
    const token = await lib.issueVerification(user.id);
    const row = await prisma.emailVerification.findFirstOrThrow({ where: { userId: user.id } });

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(lib.hashVerificationToken(token!));

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("marks the address verified", async () => {
    const user = await makeUser("consume");
    const token = await lib.issueVerification(user.id);

    expect((await lib.consumeVerification(token!)).status).toBe("verified");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.emailVerifiedAt).not.toBeNull();

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("reads a second click as success, not as an error", async () => {
    const user = await makeUser("twice");
    const token = await lib.issueVerification(user.id);
    await lib.consumeVerification(token!);

    // Mail clients prefetch links and people click twice. Neither should be
    // shown a failure for an address that is, in fact, confirmed.
    expect((await lib.consumeVerification(token!)).status).toBe("already");

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("rejects an unknown or expired token", async () => {
    expect((await lib.consumeVerification("never-issued")).status).toBe("invalid");

    const user = await makeUser("expired");
    const token = await lib.issueVerification(user.id);
    await prisma.emailVerification.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await lib.consumeVerification(token!)).status).toBe("invalid");

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("supersedes earlier links when a new one is sent", async () => {
    const user = await makeUser("resend");
    const first = await lib.issueVerification(user.id);
    const second = await lib.issueVerification(user.id);

    expect((await lib.consumeVerification(first!)).status).toBe("invalid");
    expect((await lib.consumeVerification(second!)).status).toBe("verified");

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("issues nothing once the address is confirmed", async () => {
    const user = await makeUser("done");
    const token = await lib.issueVerification(user.id);
    await lib.consumeVerification(token!);
    expect(await lib.issueVerification(user.id)).toBeNull();

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("blocks the outward-facing actions until confirmed", async () => {
    const user = await makeUser("gate");

    await expect(lib.requireVerifiedEmail(user.id, "ربط Instagram")).rejects.toThrow(
      lib.EmailNotVerifiedError,
    );

    const token = await lib.issueVerification(user.id);
    await lib.consumeVerification(token!);
    await expect(lib.requireVerifiedEmail(user.id, "ربط Instagram")).resolves.toBeUndefined();

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("asks one question and no more", async () => {
    // Accounts predating the feature are grandfathered by the backfill
    // migration stamping the column, not by the application comparing dates —
    // so the only thing that can grant access here is a real verification.
    const user = await makeUser("column");
    await expect(lib.requireVerifiedEmail(user.id, "دعوة الأعضاء")).rejects.toThrow();

    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await expect(lib.requireVerifiedEmail(user.id, "دعوة الأعضاء")).resolves.toBeUndefined();

    await prisma.user.delete({ where: { id: user.id } });
  });
});
