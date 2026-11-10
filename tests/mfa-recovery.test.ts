/**
 * MFA recovery codes.
 *
 * The behaviours worth pinning down are the ones that decide whether this is a
 * safety net or a backdoor: a code works exactly once, only for its own user,
 * is never stored in a readable form, and regenerating revokes the old sheet.
 *
 * The last block tests `login()` itself, because the module being correct in
 * isolation is not the point — the point is that a recovery code gets you past
 * the TOTP prompt, which is the lockout this feature exists to end.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface Row {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: Date | null;
  createdAt: Date;
}

let codes: Row[];
let users: any[];
let sessions: any[];
let attempts: any[];
let seq: number;

function matchWhere(r: Row, where: any): boolean {
  if (where.userId !== undefined && r.userId !== where.userId) return false;
  if (where.codeHash !== undefined && r.codeHash !== where.codeHash) return false;
  if (where.usedAt !== undefined && r.usedAt !== where.usedAt) return false;
  return true;
}

vi.mock("@/lib/db", () => ({
  prisma: {
    // Transactions here are only ever used to make delete+create atomic, and
    // the fake runs the promises it is handed, which is enough for that.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    mfaRecoveryCode: {
      deleteMany: async ({ where }: any) => {
        const before = codes.length;
        codes = codes.filter((r) => !matchWhere(r, where));
        return { count: before - codes.length };
      },
      createMany: async ({ data }: any) => {
        for (const d of data) {
          codes.push({ id: `c${seq++}`, usedAt: null, createdAt: new Date(), ...d });
        }
        return { count: data.length };
      },
      updateMany: async ({ where, data }: any) => {
        const hit = codes.filter((r) => matchWhere(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
      count: async ({ where }: any) => codes.filter((r) => matchWhere(r, where)).length,
    },
    user: {
      findUnique: async ({ where }: any) => users.find((u) => u.email === where.email) ?? null,
    },
    session: {
      create: async ({ data }: any) => {
        sessions.push(data);
        return data;
      },
    },
    loginAttempt: {
      count: async ({ where }: any) =>
        attempts.filter((a) => a.email === where.email && a.success === false).length,
      create: async ({ data }: any) => {
        attempts.push(data);
        return data;
      },
    },
  },
}));

// A real bcrypt round per test is slow and proves nothing here; the password
// path has its own coverage.
vi.mock("bcryptjs", () => ({
  default: {
    compare: async (plain: string, hash: string) => hash === `hashed:${plain}`,
    hash: async (plain: string) => `hashed:${plain}`,
  },
}));

let totpValid = false;
vi.mock("@/lib/totp", () => ({
  verifyTotp: () => totpValid,
  // Pass-through: whether the stored secret is encrypted is tested in
  // totp.test.ts, and faking it here would only couple these tests to that.
  openSecret: (stored: string) => stored,
}));

describe("MFA recovery codes", () => {
  let lib: typeof import("@/lib/mfa-recovery");

  beforeEach(async () => {
    codes = [];
    users = [];
    sessions = [];
    attempts = [];
    seq = 0;
    totpValid = false;
    lib = await import("@/lib/mfa-recovery");
  });

  describe("generating", () => {
    it("issues ten codes", async () => {
      expect(await lib.generateRecoveryCodes("u1")).toHaveLength(lib.CODE_COUNT);
    });

    it("stores hashes, never the codes themselves", async () => {
      const issued = await lib.generateRecoveryCodes("u1");

      // The stored form must not contain, or be, any issued code — a database
      // read must not yield a working second factor.
      const stored = codes.map((c) => c.codeHash);
      for (const code of issued) {
        expect(stored).not.toContain(code);
        expect(stored).not.toContain(lib.normalize(code));
      }
      expect(stored.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    });

    it("issues no duplicates within a set", async () => {
      const issued = (await lib.generateRecoveryCodes("u1")).map(lib.normalize);
      expect(new Set(issued).size).toBe(issued.length);
    });

    it("avoids characters that are misread on paper", async () => {
      // These get written down and typed back under stress. A code that reads
      // wrong is a lockout, which is the failure this feature prevents.
      const issued = await lib.generateRecoveryCodes("u1");
      for (const code of issued) {
        expect(lib.normalize(code)).not.toMatch(/[O0I1L]/);
      }
    });

    it("replaces the previous set rather than adding to it", async () => {
      const first = await lib.generateRecoveryCodes("u1");
      await lib.generateRecoveryCodes("u1");

      expect(codes).toHaveLength(lib.CODE_COUNT);
      // A sheet of paper thrown away last year must not still open the account.
      expect(await lib.consumeRecoveryCode("u1", first[0])).toBe(false);
    });
  });

  describe("spending a code", () => {
    it("accepts a valid code", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      expect(await lib.consumeRecoveryCode("u1", issued[3])).toBe(true);
    });

    it("refuses the same code a second time", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      expect(await lib.consumeRecoveryCode("u1", issued[0])).toBe(true);
      expect(await lib.consumeRecoveryCode("u1", issued[0])).toBe(false);
    });

    it("leaves the other codes usable", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      await lib.consumeRecoveryCode("u1", issued[0]);
      expect(await lib.consumeRecoveryCode("u1", issued[1])).toBe(true);
    });

    it("forgives case, spacing and dashes", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      const messy = ` ${issued[0].toLowerCase().replace("-", " ")}  `;
      expect(await lib.consumeRecoveryCode("u1", messy)).toBe(true);
    });

    it("refuses a code belonging to another user", async () => {
      const mine = await lib.generateRecoveryCodes("u1");
      await lib.generateRecoveryCodes("u2");

      // The hash is salted with the user id, so a hash lifted from one row
      // cannot be replayed against another account.
      expect(await lib.consumeRecoveryCode("u2", mine[0])).toBe(false);
      expect(await lib.consumeRecoveryCode("u1", mine[0])).toBe(true);
    });

    it("refuses nonsense and empty input", async () => {
      await lib.generateRecoveryCodes("u1");
      for (const bad of ["", "   ", "-", "NOTACODE", "!!!!!"]) {
        expect(await lib.consumeRecoveryCode("u1", bad)).toBe(false);
      }
    });
  });

  describe("counting and clearing", () => {
    it("counts only unused codes", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      expect(await lib.remainingRecoveryCodes("u1")).toBe(10);

      await lib.consumeRecoveryCode("u1", issued[0]);
      await lib.consumeRecoveryCode("u1", issued[1]);

      expect(await lib.remainingRecoveryCodes("u1")).toBe(8);
    });

    it("clears every code, spent or not", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      await lib.consumeRecoveryCode("u1", issued[0]);

      await lib.clearRecoveryCodes("u1");

      expect(codes).toHaveLength(0);
      expect(await lib.remainingRecoveryCodes("u1")).toBe(0);
    });

    it("clearing one user leaves another's codes alone", async () => {
      await lib.generateRecoveryCodes("u1");
      await lib.generateRecoveryCodes("u2");

      await lib.clearRecoveryCodes("u1");

      expect(await lib.remainingRecoveryCodes("u2")).toBe(lib.CODE_COUNT);
    });
  });

  describe("login() — the lockout this ends", () => {
    let auth: typeof import("@/lib/auth");

    beforeEach(async () => {
      auth = await import("@/lib/auth");
      users.push({
        id: "u1",
        email: "a@b.test",
        passwordHash: "hashed:pw",
        mfaEnabled: true,
        mfaSecret: "SECRET",
      });
    });

    it("signs in with a recovery code when the authenticator is gone", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      totpValid = false; // the phone is lost; no valid TOTP exists

      const r = await auth.login("a@b.test", "pw", { totp: issued[0] });

      expect(r.ok).toBe(true);
      expect(r.ok && r.usedRecoveryCode).toBe(true);
      expect(r.ok && r.recoveryCodesRemaining).toBe(9);
    });

    it("does not spend a code when the TOTP code works", async () => {
      await lib.generateRecoveryCodes("u1");
      totpValid = true;

      const r = await auth.login("a@b.test", "pw", { totp: "123456" });

      expect(r.ok).toBe(true);
      expect(r.ok && r.usedRecoveryCode).toBe(false);
      // The ordinary path must not quietly burn a recovery code.
      expect(await lib.remainingRecoveryCodes("u1")).toBe(10);
    });

    it("rejects a recovery code already spent", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      totpValid = false;
      await auth.login("a@b.test", "pw", { totp: issued[0] });

      const again = await auth.login("a@b.test", "pw", { totp: issued[0] });

      expect(again.ok).toBe(false);
      expect(!again.ok && again.error).toBe("MFA_INVALID");
    });

    it("still requires the password", async () => {
      const issued = await lib.generateRecoveryCodes("u1");
      totpValid = false;

      const r = await auth.login("a@b.test", "wrong-password", { totp: issued[0] });

      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe("INVALID_CREDENTIALS");
      // A rejected sign-in must not consume a code, or an attacker with a
      // leaked sheet could exhaust it without ever knowing the password.
      expect(await lib.remainingRecoveryCodes("u1")).toBe(10);
    });

    it("still asks for a second factor at all", async () => {
      await lib.generateRecoveryCodes("u1");

      const r = await auth.login("a@b.test", "pw", {});

      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe("MFA_REQUIRED");
    });
  });
});
