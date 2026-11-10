/**
 * Password reset — the properties that make it safe rather than merely working.
 *
 * These run against a real Postgres because every guarantee here is enforced by
 * the database (a unique token hash, a single-use flag, a transaction), not by
 * anything a mock would exercise.
 */
import { describe, it, expect, beforeAll } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error(
    "TEST_DATABASE_URL is required in CI — password reset must not be skipped on the merge path",
  );
}

describe.skipIf(!HAS_DB)("Password reset", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let lib: typeof import("@/lib/password-reset");
  let auth: typeof import("@/lib/auth");

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    lib = await import("@/lib/password-reset");
    auth = await import("@/lib/auth");
  });

  async function makeUser(suffix: string) {
    return prisma.user.create({
      data: {
        email: `reset-${suffix}-${Date.now()}@example.test`,
        fullName: "اختبار",
        passwordHash: await auth.hashPassword("original-password"),
      },
    });
  }

  it("stores only the hash — the raw token is never written down", async () => {
    const user = await makeUser("hash");
    const issued = await lib.issueReset(user.email);
    expect(issued).not.toBeNull();

    const row = await prisma.passwordReset.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.tokenHash).not.toBe(issued!.token);
    expect(row.tokenHash).toBe(lib.hashResetToken(issued!.token));

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("issues nothing for an unknown address", async () => {
    expect(await lib.issueReset("nobody-here@example.test")).toBeNull();
  });

  it("issues nothing for an account that has never set a password", async () => {
    // An invited-but-not-accepted account: resetting it would route around the
    // invitation flow entirely.
    const user = await prisma.user.create({
      data: { email: `invited-${Date.now()}@example.test`, fullName: "مدعو" },
    });
    expect(await lib.issueReset(user.email)).toBeNull();
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("changes the password and burns the token", async () => {
    const user = await makeUser("consume");
    const issued = await lib.issueReset(user.email);

    const result = await lib.consumeReset(issued!.token, "brand-new-password");
    expect(result.ok).toBe(true);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await auth.verifyPassword("brand-new-password", after.passwordHash!)).toBe(true);
    expect(await auth.verifyPassword("original-password", after.passwordHash!)).toBe(false);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses a token that was already used", async () => {
    const user = await makeUser("replay");
    const issued = await lib.issueReset(user.email);

    expect((await lib.consumeReset(issued!.token, "first-new-password")).ok).toBe(true);
    // A reset link in an inbox stays there. Using it twice must not work.
    expect((await lib.consumeReset(issued!.token, "second-new-password")).ok).toBe(false);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await auth.verifyPassword("first-new-password", after.passwordHash!)).toBe(true);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses an expired token", async () => {
    const user = await makeUser("expired");
    const issued = await lib.issueReset(user.email);
    await prisma.passwordReset.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await lib.resetIsValid(issued!.token)).toBe(false);
    expect((await lib.consumeReset(issued!.token, "too-late-password")).ok).toBe(false);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("invalidates other outstanding links for the same account", async () => {
    const user = await makeUser("multi");
    const first = await lib.issueReset(user.email);
    const second = await lib.issueReset(user.email);

    expect((await lib.consumeReset(second!.token, "chosen-new-password")).ok).toBe(true);
    // The earlier email is now stale — otherwise a link sent before an account
    // takeover attempt stays live after the victim has recovered.
    expect((await lib.consumeReset(first!.token, "stale-link-password")).ok).toBe(false);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("revokes every session and clears the lockout", async () => {
    const user = await makeUser("sessions");

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: `session-${Date.now()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    // Five failures is the lockout threshold; a reset must not leave the
    // account locked against its own new password.
    for (let i = 0; i < 5; i++) {
      await prisma.loginAttempt.create({ data: { userId: user.id, email: user.email, success: false } });
    }

    const issued = await lib.issueReset(user.email);
    expect((await lib.consumeReset(issued!.token, "recovered-password")).ok).toBe(true);

    const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);

    const failures = await prisma.loginAttempt.count({ where: { email: user.email, success: false } });
    expect(failures).toBe(0);

    const signIn = await auth.login(user.email, "recovered-password", {});
    expect(signIn.ok).toBe(true);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("stops issuing after too many open requests for one account", async () => {
    const user = await makeUser("flood");
    for (let i = 0; i < 3; i++) expect(await lib.issueReset(user.email)).not.toBeNull();
    // Anyone can type someone else's address into the form; they should not be
    // able to fill that person's inbox with it.
    expect(await lib.issueReset(user.email)).toBeNull();

    await prisma.user.delete({ where: { id: user.id } });
  });
});
