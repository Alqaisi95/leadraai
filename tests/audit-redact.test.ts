import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { redactForAudit } from "@/lib/audit";

/**
 * Callers hand whole Prisma rows to audit(). The previous implementation walked
 * every object with Object.entries, which broke on the two value types those
 * rows always contain:
 *
 *  - Decimal carries an own *enumerable* `constructor` function; copying it put
 *    a function in the Json column and Prisma refused the write, 500-ing the
 *    request. Editing any lead with a budget failed in production.
 *  - Date has no own keys, so it silently became `{}` and the audit trail lost
 *    every timestamp.
 */
describe("redactForAudit — تحضير القيم لسجل التدقيق", () => {
  it("turns a Prisma Decimal into a number, not its internals", () => {
    const out = redactForAudit({ price: new Prisma.Decimal("95000.50") }) as any;
    expect(out.price).toBe(95000.5);
    expect(typeof out.price).toBe("number");
  });

  it("never lets a function reach the Json column", () => {
    // the exact failure: Decimal's own enumerable `constructor`
    const out = redactForAudit({ price: new Prisma.Decimal(1) });
    expect(JSON.stringify(out)).not.toContain("constructor");
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("keeps a Date as a readable timestamp instead of an empty object", () => {
    const out = redactForAudit({ at: new Date("2026-08-04T10:00:00.000Z") }) as any;
    expect(out.at).toBe("2026-08-04T10:00:00.000Z");
  });

  it("still redacts sensitive keys", () => {
    const out = redactForAudit({ passwordHash: "x", encryptedToken: "y", name: "ok" }) as any;
    expect(out.passwordHash).toBe("[REDACTED]");
    expect(out.encryptedToken).toBe("[REDACTED]");
    expect(out.name).toBe("ok");
  });

  it("redacts nested sensitive keys", () => {
    const out = redactForAudit({ user: { mfaSecret: "s", email: "a@b.c" } }) as any;
    expect(out.user.mfaSecret).toBe("[REDACTED]");
    expect(out.user.email).toBe("a@b.c");
  });

  it("walks arrays and plain nested objects", () => {
    const out = redactForAudit({
      rows: [{ price: new Prisma.Decimal(10) }, { price: new Prisma.Decimal(20) }],
    }) as any;
    expect(out.rows.map((r: any) => r.price)).toEqual([10, 20]);
  });

  it("preserves primitives and null", () => {
    const out = redactForAudit({ a: 1, b: "x", c: true, d: null }) as any;
    expect(out).toEqual({ a: 1, b: "x", c: true, d: null });
  });

  it("stringifies a bigint rather than throwing on serialization", () => {
    const out = redactForAudit({ n: 9007199254740993n }) as any;
    expect(out.n).toBe("9007199254740993");
    expect(() => JSON.stringify(out)).not.toThrow();
  });

  it("produces output that always survives JSON.stringify", () => {
    const row = {
      price: new Prisma.Decimal("125000"),
      createdAt: new Date(),
      nested: { budgetMin: new Prisma.Decimal("1"), tags: ["a"] },
      cb: () => null,
    };
    expect(() => JSON.stringify(redactForAudit(row))).not.toThrow();
    expect(JSON.stringify(redactForAudit(row))).not.toContain("function");
  });
});
