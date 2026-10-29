/**
 * R1.7 — tenant isolation tests. Require a Postgres test DB:
 *   TEST_DATABASE_URL=postgresql://... vitest run tests/isolation.integration.test.ts
 * Skipped automatically when TEST_DATABASE_URL is absent (unit CI stays green;
 * the full CI job provisions Postgres and MUST run these before merge).
 */
import { describe, it, expect } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!HAS_DB)("Tenant isolation (R1.7)", () => {
  it("org A member cannot read org B leads via scoped()", async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { prisma } = await import("@/lib/db");
    const { scoped } = await import("@/lib/tenant");

    const orgA = await prisma.organization.create({ data: { name: "A-" + Date.now() } });
    const orgB = await prisma.organization.create({ data: { name: "B-" + Date.now() } });
    const leadB = await prisma.lead.create({ data: { organizationId: orgB.id, fullName: "سري" } });

    const ctxA = { organizationId: orgA.id, memberId: "m", userId: "u", role: "ORG_ADMIN" as const };
    const found = await prisma.lead.findFirst({ where: { ...scoped(ctxA), id: leadB.id } });
    expect(found).toBeNull();

    await prisma.lead.delete({ where: { id: leadB.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  });
});
