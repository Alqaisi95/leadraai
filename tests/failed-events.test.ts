/**
 * Dead-lettered messages can be seen and retried — by their own tenant only.
 *
 * The retry takes its id in the request body, so the [id]-route tripwire in
 * api-contract.test.ts does not see it. The isolation cases live here instead:
 * a route that requeues work is exactly the kind where reaching another
 * tenant's row would matter.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildTenant, destroyTenant, call, type Tenant } from "./helpers/api-harness";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — failed-event isolation must not be skipped");
}

describe.skipIf(!HAS_DB)("Failed events", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let route: typeof import("@/app/api/webhook-events/route");
  let a: Tenant;
  let b: Tenant;
  let deadA: string;
  let deadB: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    route = await import("@/app/api/webhook-events/route");
    a = await buildTenant(prisma, "fe-alpha");
    b = await buildTenant(prisma, "fe-beta");
  });

  afterAll(async () => {
    await prisma.webhookEvent.deleteMany({ where: { externalEventId: { startsWith: "fe-" } } });
    if (a) await destroyTenant(prisma, a);
    if (b) await destroyTenant(prisma, b);
  });

  async function dead(organizationId: string, tag: string, text: string) {
    const ev = await prisma.webhookEvent.create({
      data: {
        organizationId,
        provider: "INSTAGRAM",
        externalEventId: `fe-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        rawPayload: { entryId: "ig", messaging: { sender: { id: `sender-${tag}` }, message: { text } } },
        status: "DEAD_LETTER",
        attempts: 5,
        lastError: "Error: boom",
      },
    });
    return ev.id;
  }

  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany({ where: { externalEventId: { startsWith: "fe-" } } });
    deadA = await dead(a.organizationId, "a", "رسالة ألفا السرية");
    deadB = await dead(b.organizationId, "b", "رسالة بيتا");
  });

  it("lists only the caller's own failed messages", async () => {
    const res = await call(route.GET, "/api/webhook-events", { actor: a.admin });
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: any) => i.id)).toEqual([deadA]);
    expect(res.json.items[0].preview).toBe("رسالة ألفا السرية");
    expect(res.text).not.toContain("بيتا");
    // the raw Meta envelope stays server-side
    expect(res.json.items[0].rawPayload).toBeUndefined();
  });

  it("refuses to retry another tenant's message, as a 404", async () => {
    const res = await call(route.POST, "/api/webhook-events", {
      actor: b.admin,
      method: "POST",
      body: { id: deadA },
    });
    expect(res.status).toBe(404);
    const untouched = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: deadA } });
    expect(untouched.status).toBe("DEAD_LETTER");
    expect(untouched.attempts).toBe(5);
  });

  it("requeues the caller's own message with fresh attempts and records who did it", async () => {
    const res = await call(route.POST, "/api/webhook-events", {
      actor: a.admin,
      method: "POST",
      body: { id: deadA },
    });
    expect(res.status).toBe(200);
    const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: deadA } });
    expect(after.status).toBe("QUEUED");
    expect(after.attempts).toBe(0);
    expect(after.lastError).toBeNull();

    const logged = await prisma.auditLog.findFirst({
      where: { organizationId: a.organizationId, action: "webhook_event.retry", entityId: deadA },
    });
    expect(logged?.actorUserId).toBe(a.admin.userId);

    // the other tenant's row is untouched
    const other = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: deadB } });
    expect(other.status).toBe("DEAD_LETTER");
  });

  it("is a 404 the second time — a message is retried once, not stacked", async () => {
    const first = await call(route.POST, "/api/webhook-events", {
      actor: a.admin,
      method: "POST",
      body: { id: deadA },
    });
    expect(first.status).toBe(200);
    const second = await call(route.POST, "/api/webhook-events", {
      actor: a.admin,
      method: "POST",
      body: { id: deadA },
    });
    expect(second.status).toBe(404);
  });

  it("is closed to roles that do not manage integrations", async () => {
    const list = await call(route.GET, "/api/webhook-events", { actor: a.agent });
    expect(list.status).toBe(403);
    const retry = await call(route.POST, "/api/webhook-events", {
      actor: a.viewer,
      method: "POST",
      body: { id: deadA },
    });
    expect(retry.status).toBe(403);
    const untouched = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: deadA } });
    expect(untouched.status).toBe("DEAD_LETTER");
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await call(route.GET, "/api/webhook-events");
    expect(res.status).toBe(401);
  });
});
