/**
 * The API contract, exercised through the handlers themselves.
 *
 * Everything here is enforced by `withAuth` and by each route's opening lines,
 * which no library-level test touches. The single most important claim the
 * product makes — that one organization can never read another's records — is
 * checked here against every `[id]` route there is, so adding a new one without
 * scoping it fails the suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTenant, destroyTenant, call, type Tenant } from "./helpers/api-harness";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — the API contract must not be skipped");
}

describe.skipIf(!HAS_DB)("API contract", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let a: Tenant;
  let b: Tenant;

  /** Every `[id]` route, with the id that exists in tenant A. */
  let routes: {
    name: string;
    path: (t: Tenant) => string;
    handler: any;
    method?: string;
    body?: unknown;
    skipIsolation?: boolean;
  }[];

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));

    a = await buildTenant(prisma, "alpha");
    b = await buildTenant(prisma, "beta");

    const [
      leads,
      leadNotes,
      leadMatches,
      leadMerge,
      units,
      unitStatus,
      tasks,
      appts,
      convs,
      convMsgs,
      assist,
      knowledge,
      oppMove,
      sequences,
      reportSchedules,
    ] = await Promise.all([
      import("@/app/api/leads/[id]/route"),
      import("@/app/api/leads/[id]/notes/route"),
      import("@/app/api/leads/[id]/matches/route"),
      import("@/app/api/leads/[id]/merge/route"),
      import("@/app/api/units/[id]/route"),
      import("@/app/api/units/[id]/status/route"),
      import("@/app/api/tasks/[id]/route"),
      import("@/app/api/appointments/[id]/route"),
      import("@/app/api/conversations/[id]/route"),
      import("@/app/api/conversations/[id]/messages/route"),
      import("@/app/api/conversations/[id]/assist/route"),
      import("@/app/api/knowledge-sources/[id]/route"),
      import("@/app/api/opportunities/[id]/move/route"),
      import("@/app/api/sequences/[id]/route"),
      import("@/app/api/reports/schedules/[id]/route"),
    ]);

    routes = [
      // One entry per exported verb, matching what each file actually exports.
      { name: "/leads/[id]", path: (t) => `/api/leads/${t.leadId}`, handler: leads.GET },
      {
        name: "/leads/[id]",
        path: (t) => `/api/leads/${t.leadId}`,
        handler: leads.PATCH,
        method: "PATCH",
        body: { fullName: "محاولة تعديل" },
      },
      {
        name: "/leads/[id]/notes",
        path: (t) => `/api/leads/${t.leadId}/notes`,
        handler: leadNotes.POST,
        method: "POST",
        body: { body: "ملاحظة" },
      },
      {
        name: "/leads/[id]/matches",
        path: (t) => `/api/leads/${t.leadId}/matches`,
        handler: leadMatches.GET,
      },
      {
        name: "/leads/[id]/merge",
        path: (t) => `/api/leads/${t.leadId}/merge`,
        handler: leadMerge.POST,
        method: "POST",
        body: { duplicateLeadId: "some-other-lead" },
      },
      {
        name: "/units/[id]",
        path: (t) => `/api/units/${t.unitId}`,
        handler: units.PATCH,
        method: "PATCH",
        body: { price: 1 },
      },
      {
        name: "/units/[id]",
        path: (t) => `/api/units/${t.unitId}`,
        handler: units.DELETE,
        method: "DELETE",
      },
      {
        name: "/units/[id]/status",
        path: (t) => `/api/units/${t.unitId}/status`,
        handler: unitStatus.PATCH,
        method: "PATCH",
        body: { status: "SOLD" },
      },
      {
        name: "/tasks/[id]",
        path: (t) => `/api/tasks/${t.taskId}`,
        handler: tasks.PATCH,
        method: "PATCH",
        body: { status: "DONE" },
      },
      {
        name: "/appointments/[id]",
        path: (t) => `/api/appointments/${t.appointmentId}`,
        handler: appts.PATCH,
        method: "PATCH",
        body: { status: "CANCELLED" },
      },
      {
        name: "/conversations/[id]",
        path: (t) => `/api/conversations/${t.conversationId}`,
        handler: convs.PATCH,
        method: "PATCH",
        body: { status: "CLOSED" },
      },
      {
        name: "/conversations/[id]/messages",
        path: (t) => `/api/conversations/${t.conversationId}/messages`,
        handler: convMsgs.GET,
      },
      {
        name: "/conversations/[id]/messages",
        path: (t) => `/api/conversations/${t.conversationId}/messages`,
        handler: convMsgs.POST,
        method: "POST",
        body: { text: "رسالة" },
      },
      {
        // Excluded from the isolation sweep below, not from the list: this route
        // reaches the AI provider before it reaches the tenant lookup, so
        // without ANTHROPIC_API_KEY it answers 503 and proves nothing either
        // way. It is still covered by the session and CSRF sweeps.
        skipIsolation: true,
        name: "/conversations/[id]/assist",
        path: (t) => `/api/conversations/${t.conversationId}/assist`,
        handler: assist.POST,
        method: "POST",
        body: { mode: "suggest" },
      },
      {
        name: "/knowledge-sources/[id]",
        path: (t) => `/api/knowledge-sources/${t.knowledgeSourceId}`,
        handler: knowledge.GET,
      },
      {
        name: "/knowledge-sources/[id]",
        path: (t) => `/api/knowledge-sources/${t.knowledgeSourceId}`,
        handler: knowledge.PATCH,
        method: "PATCH",
        body: { title: "محاولة" },
      },
      {
        name: "/knowledge-sources/[id]",
        path: (t) => `/api/knowledge-sources/${t.knowledgeSourceId}`,
        handler: knowledge.DELETE,
        method: "DELETE",
      },
      {
        name: "/reports/schedules/[id]",
        path: (t) => `/api/reports/schedules/${t.scheduleId}`,
        handler: reportSchedules.PATCH,
        method: "PATCH",
        body: { isActive: false },
      },
      {
        name: "/reports/schedules/[id]",
        path: (t) => `/api/reports/schedules/${t.scheduleId}`,
        handler: reportSchedules.DELETE,
        method: "DELETE",
      },
      { name: "/sequences/[id]", path: (t) => `/api/sequences/${t.sequenceId}`, handler: sequences.GET },
      {
        name: "/sequences/[id]",
        path: (t) => `/api/sequences/${t.sequenceId}`,
        handler: sequences.PATCH,
        method: "PATCH",
        body: { isActive: false },
      },
      {
        name: "/sequences/[id]",
        path: (t) => `/api/sequences/${t.sequenceId}`,
        handler: sequences.DELETE,
        method: "DELETE",
      },
      {
        name: "/opportunities/[id]/move",
        path: (t) => `/api/opportunities/${t.opportunityId}/move`,
        handler: oppMove.POST,
        method: "POST",
        body: { stageId: "does-not-matter" },
      },
    ];
  });

  /** The two lead handlers, for the tests that need one specific route. */
  const leadsGet = () => routes.find((r) => r.name === "/leads/[id]" && !r.method)!.handler;
  const leadsPatch = () => routes.find((r) => r.name === "/leads/[id]" && r.method === "PATCH")!.handler;

  afterAll(async () => {
    if (a) await destroyTenant(prisma, a);
    if (b) await destroyTenant(prisma, b);
  });

  // -------------------------------------------------------------------------

  describe("tenant isolation", () => {
    it("has a case for every [id] route on disk", async () => {
      // The isolation check below is only as good as this list. A new [id]
      // route added without a case here should fail the suite rather than
      // quietly ship unverified — this is the tripwire for that.
      const { readdirSync, statSync } = await import("fs");
      const { join } = await import("path");

      const found: string[] = [];
      (function walk(dir: string) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else if (entry === "route.ts" && full.includes("[id]")) found.push(full);
        }
      })("src/app/api");

      // Each file may export several verbs; what matters is that the file is
      // represented at all.
      const covered = new Set(routes.map((r) => r.name));
      const missing = found
        .map((file) => file.replace(/^src\/app\/api/, "").replace(/\/route\.ts$/, ""))
        .filter((route) => !covered.has(route));

      expect(found.length).toBeGreaterThan(0);
      expect(missing).toEqual([]);
    });

    it("refuses every [id] route when the record belongs to another tenant", async () => {
      const failures: string[] = [];

      for (const route of routes.filter((r) => !r.skipIsolation)) {
        // Tenant B's admin, with B's org header, asking for A's record id.
        const res = await call(route.handler, route.path(a), {
          actor: b.admin,
          method: route.method,
          body: route.body,
        });

        // 404 rather than 403 on purpose: a 403 would confirm the record exists.
        if (res.status !== 404) failures.push(`${route.name} → ${res.status}`);
      }

      expect(failures).toEqual([]);
    });

    it("does not leak the other tenant's data in the body either", async () => {
      const res = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: b.admin });
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("alpha");
    });

    it("still serves each tenant its own records", async () => {
      // The isolation checks above would also pass if everything were broken,
      // so prove the happy path works before trusting the refusals.
      const own = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: a.admin });
      expect(own.status).toBe(200);
      expect(own.json.lead.fullName).toContain("alpha");
    });

    it("rejects a session pointed at an organization it is not a member of", async () => {
      // The org header is client-supplied; membership is what decides.
      const res = await call(leadsGet(), `/api/leads/${a.leadId}`, {
        actor: b.admin,
        organizationId: a.organizationId,
      });
      expect(res.status).toBe(401);
    });
  });

  describe("session", () => {
    it("refuses every route without a session", async () => {
      const failures: string[] = [];
      for (const route of routes) {
        const res = await call(route.handler, route.path(a), { method: route.method, body: route.body });
        if (res.status !== 401) failures.push(`${route.name} → ${res.status}`);
      }
      expect(failures).toEqual([]);
    });

    it("refuses a revoked session", async () => {
      const token = a.admin.sessionToken;
      await prisma.session.updateMany({
        where: { user: { id: a.admin.userId } },
        data: { revokedAt: new Date() },
      });
      const res = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: a.admin });
      expect(res.status).toBe(401);

      await prisma.session.updateMany({ where: { user: { id: a.admin.userId } }, data: { revokedAt: null } });
      expect(token).toBe(a.admin.sessionToken); // sanity: we restored the same session
    });

    it("refuses an expired session", async () => {
      await prisma.session.updateMany({
        where: { user: { id: a.admin.userId } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: a.admin });
      expect(res.status).toBe(401);

      await prisma.session.updateMany({
        where: { user: { id: a.admin.userId } },
        data: { expiresAt: new Date(Date.now() + 86_400_000) },
      });
    });
  });

  describe("CSRF", () => {
    it("refuses cookie-authenticated mutations whose token does not match", async () => {
      const mutating = routes.filter((r) => r.method && r.method !== "GET");
      expect(mutating.length).toBeGreaterThan(0);

      const failures: string[] = [];
      for (const route of mutating) {
        const res = await call(route.handler, route.path(a), {
          actor: a.admin,
          method: route.method,
          body: route.body,
          breakCsrf: true,
        });
        if (res.status !== 403 || res.json?.error?.code !== "CSRF") {
          failures.push(`${route.name} → ${res.status} ${res.json?.error?.code ?? ""}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it("leaves reads alone", async () => {
      const res = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: a.admin, breakCsrf: true });
      expect(res.status).toBe(200);
    });
  });

  describe("permissions", () => {
    it("lets a viewer read but never write", async () => {
      const read = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: a.viewer });
      expect(read.status).toBe(200);

      const write = await call(leadsPatch(), `/api/leads/${a.leadId}`, {
        actor: a.viewer,
        method: "PATCH",
        body: { fullName: "لا يجوز" },
      });
      expect(write.status).toBe(403);
      expect(write.json?.error?.code).toBe("FORBIDDEN");
    });

    it("hides another agent's lead from an agent", async () => {
      // Agents see their own book. Someone else's lead must read as absent, not
      // as forbidden — same reasoning as the cross-tenant 404.
      const other = await prisma.lead.create({
        data: {
          organizationId: a.organizationId,
          fullName: "عميل لموظف آخر",
          ownerMemberId: a.admin.memberId,
        },
      });
      const res = await call(leadsGet(), `/api/leads/${other.id}`, { actor: a.agent });
      expect(res.status).toBe(404);

      await prisma.lead.delete({ where: { id: other.id } });
    });
  });

  describe("responses", () => {
    it("carries a correlation id on success and on failure", async () => {
      const ok = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: a.admin });
      expect(ok.headers.get("x-correlation-id")).toBeTruthy();

      const bad = await call(leadsGet(), `/api/leads/${a.leadId}`, { actor: b.admin });
      expect(bad.json?.error?.correlationId).toBeTruthy();
    });

    it("rejects a malformed body with 422, not 500", async () => {
      const res = await call(leadsPatch(), `/api/leads/${a.leadId}`, {
        actor: a.admin,
        method: "PATCH",
        body: { budgetMin: "not-a-number", phone: 12345 },
      });
      expect(res.status).toBe(422);
    });
  });
});
