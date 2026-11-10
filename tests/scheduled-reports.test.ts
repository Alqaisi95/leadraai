/**
 * Scheduled report delivery.
 *
 * The tests worth having are the two that make this a safe feature rather than
 * a hole: a schedule can only address members of its own organization, and it
 * generates with its creator's *current* permissions. Everything else is
 * plumbing.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — scheduled reports must not be skipped");
}

/** Every email the code tried to send, and whether the transport accepted it. */
const mails: { to: string; subject: string; attachments?: any[] }[] = [];
/** Set to false for one run to simulate an unreachable mail host. */
let mailTransportWorks = true;

vi.mock("@/lib/email", () => ({
  sendEmail: async (to: string, subject: string, _text: string, attachments?: any[]) => {
    if (!mailTransportWorks) return false;
    mails.push({ to, subject, attachments });
    return true;
  },
}));

describe.skipIf(!HAS_DB)("Scheduled reports", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let lib: typeof import("@/lib/scheduled-reports");
  let orgId: string;
  let otherOrgId: string;
  let managerId: string;
  let agentId: string;
  let outsiderId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    lib = await import("@/lib/scheduled-reports");
  });

  async function member(organizationId: string, role: string, tag: string) {
    const user = await prisma.user.create({
      data: { email: `sr-${tag}-${Date.now()}@example.test`, fullName: `عضو ${tag}`, passwordHash: "x" },
    });
    const m = await prisma.organizationMember.create({
      data: { organizationId, userId: user.id, role: role as any, status: "ACTIVE" },
    });
    return m.id;
  }

  beforeEach(async () => {
    mails.length = 0;
    mailTransportWorks = true;
    await prisma.organization.deleteMany({ where: { name: { startsWith: "sr-test-" } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "sr-" } } });

    const org = await prisma.organization.create({ data: { name: `sr-test-a-${Date.now()}` } });
    const other = await prisma.organization.create({ data: { name: `sr-test-b-${Date.now()}` } });
    orgId = org.id;
    otherOrgId = other.id;
    managerId = await member(orgId, "SALES_MANAGER", "mgr");
    agentId = await member(orgId, "AGENT", "agent");
    outsiderId = await member(otherOrgId, "ORG_ADMIN", "outsider");
  });

  async function schedule(opts: { recipients: string[]; createdBy?: string; report?: string }) {
    return prisma.scheduledReport.create({
      data: {
        organizationId: orgId,
        createdByMemberId: opts.createdBy ?? managerId,
        report: opts.report ?? "leads",
        frequency: "WEEKLY",
        recipientMemberIds: opts.recipients,
        nextRunAt: new Date(Date.now() - 1000),
      },
    });
  }

  // -------------------------------------------------------------------------

  describe("recipients", () => {
    it("delivers to members of the organization", async () => {
      await schedule({ recipients: [managerId, agentId] });
      expect(await lib.runDueReports()).toMatchObject({ due: 1, failed: 0 });
      expect(mails).toHaveLength(2);
    });

    it("never delivers to a member of another organization", async () => {
      // The id is real and the row stores it; resolution is what refuses. A
      // schedule must not become a way to mail people outside the tenant.
      await schedule({ recipients: [outsiderId] });
      await lib.runDueReports();
      expect(mails).toHaveLength(0);
    });

    it("stops mailing a member who left the team", async () => {
      await schedule({ recipients: [managerId, agentId] });
      await prisma.organizationMember.update({ where: { id: agentId }, data: { status: "SUSPENDED" } });

      await lib.runDueReports();
      // Nobody has to remember to edit the schedule.
      expect(mails).toHaveLength(1);
    });
  });

  describe("permissions travel with the creator", () => {
    it("refuses when the creator may no longer read the report", async () => {
      // The team report needs reports.read.team, which an AGENT does not have.
      await schedule({ recipients: [managerId], createdBy: agentId, report: "team" });

      const result = await lib.runDueReports();
      expect(result.failed).toBe(1);
      expect(mails).toHaveLength(0);

      const after = await prisma.scheduledReport.findFirstOrThrow({ where: { organizationId: orgId } });
      expect(after.lastError).toBeTruthy();
      expect(after.lastSentAt).toBeNull();
    });

    it("refuses when the creator is no longer an active member", async () => {
      await schedule({ recipients: [agentId], createdBy: managerId });
      await prisma.organizationMember.update({ where: { id: managerId }, data: { status: "SUSPENDED" } });

      const result = await lib.runDueReports();
      expect(result.failed).toBe(1);
      expect(mails).toHaveLength(0);
    });
  });

  describe("delivery", () => {
    it("reports a failure when nothing could be delivered", async () => {
      // A dead SMTP host must not read as "sent on Sunday" — an operator
      // trusting that line would never find out nobody received the report.
      mailTransportWorks = false;

      const s = await schedule({ recipients: [managerId] });
      const result = await lib.runDueReports();
      expect(result.failed).toBe(1);

      const after = await prisma.scheduledReport.findUniqueOrThrow({ where: { id: s.id } });
      expect(after.lastSentAt).toBeNull();
      expect(after.lastError).toMatch(/SMTP/);
    });

    it("attaches the report", async () => {
      await schedule({ recipients: [managerId] });
      await lib.runDueReports();

      expect(mails[0].attachments).toHaveLength(1);
      expect(mails[0].attachments![0].filename).toMatch(/^leadra-leads\.(xlsx|csv)$/);
      expect(Buffer.isBuffer(mails[0].attachments![0].content)).toBe(true);
    });

    it("advances the schedule and clears the previous error", async () => {
      const s = await schedule({ recipients: [managerId] });
      await prisma.scheduledReport.update({ where: { id: s.id }, data: { lastError: "قديم" } });

      await lib.runDueReports();
      const after = await prisma.scheduledReport.findUniqueOrThrow({ where: { id: s.id } });
      expect(after.lastError).toBeNull();
      expect(after.lastSentAt).not.toBeNull();
      expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });

    it("leaves a paused schedule alone", async () => {
      const s = await schedule({ recipients: [managerId] });
      await prisma.scheduledReport.update({ where: { id: s.id }, data: { isActive: false } });

      expect(await lib.runDueReports()).toMatchObject({ due: 0 });
      expect(mails).toHaveLength(0);
    });

    it("reschedules a failure instead of retrying it immediately", async () => {
      const s = await schedule({ recipients: [managerId], createdBy: agentId, report: "team" });
      await lib.runDueReports();

      // A permission problem or a dead mail host will still be there in a
      // minute; a tight retry loop would only hammer both.
      const after = await prisma.scheduledReport.findUniqueOrThrow({ where: { id: s.id } });
      expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("nextRunFrom", () => {
    it("always lands in the future", () => {
      for (const f of ["DAILY", "WEEKLY", "MONTHLY"] as const) {
        expect(lib.nextRunFrom(f).getTime()).toBeGreaterThan(Date.now());
      }
    });

    it("puts weekly runs on Sunday", () => {
      expect(lib.nextRunFrom("WEEKLY").getDay()).toBe(0);
    });

    it("puts monthly runs on the first", () => {
      expect(lib.nextRunFrom("MONTHLY").getDate()).toBe(1);
    });

    it("does not queue up catch-up runs after an outage", () => {
      // Computed from now, not from the missed due time — otherwise a deploy
      // that skipped a run would produce a burst of back-dated emails.
      const longOverdue = new Date(Date.now() - 30 * 86_400_000);
      const next = lib.nextRunFrom("DAILY", longOverdue);
      expect(next.getTime()).toBeLessThan(longOverdue.getTime() + 2 * 86_400_000);
    });
  });
});
