/**
 * Follow-up sequences.
 *
 * The valuable tests here are not "a message gets sent" — they are the three
 * guarantees that decide whether this feature helps or turns the product into
 * something customers block: a reply stops it, nobody gets more than one
 * automated message a day, and a failure surfaces instead of vanishing.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — sequences must not be skipped");
}

// Nothing may actually reach Instagram from a test run.
const sent: { to: string; text: string }[] = [];
vi.mock("@/lib/meta", () => ({
  sendInstagramMessage: async (_integrationId: string, to: string, text: string) => {
    sent.push({ to, text });
    return { message_id: `mock-${sent.length}` };
  },
}));

describe.skipIf(!HAS_DB)("Follow-up sequences", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let lib: typeof import("@/lib/sequences");
  let orgId: string;
  let integrationId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    lib = await import("@/lib/sequences");
  });

  beforeEach(async () => {
    sent.length = 0;
    await prisma.organization.deleteMany({ where: { name: { startsWith: "seq-test-" } } });
    const org = await prisma.organization.create({ data: { name: `seq-test-${Date.now()}` } });
    orgId = org.id;
    const integ = await prisma.integration.create({
      data: {
        organizationId: orgId,
        provider: "INSTAGRAM",
        status: "CONNECTED",
        externalId: `ig-${Date.now()}`,
      },
    });
    integrationId = integ.id;
  });

  /** A lead that has been silent for `hoursSilent`, with an open conversation. */
  async function makeSilentLead(name: string, hoursSilent = 72) {
    const conversation = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        integrationId,
        externalThreadId: `thread-${name}-${Date.now()}`,
        customerExternalId: `cust-${name}-${Date.now()}`,
        status: "AI_ACTIVE",
      },
    });
    return prisma.lead.create({
      data: {
        organizationId: orgId,
        fullName: name,
        conversationId: conversation.id,
        lastInteractionAt: new Date(Date.now() - hoursSilent * 3600_000),
      },
    });
  }

  async function makeSequence(
    opts: { triggerHours?: number; steps?: { delayHours: number; body: string }[] } = {},
  ) {
    return prisma.sequence.create({
      data: {
        organizationId: orgId,
        name: "متابعة",
        isActive: true,
        triggerHours: opts.triggerHours ?? 48,
        steps: {
          create: (opts.steps ?? [{ delayHours: 0, body: "تابعنا معك" }]).map((s, i) => ({
            order: i + 1,
            delayHours: s.delayHours,
            action: "SEND_MESSAGE" as const,
            body: s.body,
          })),
        },
      },
      include: { steps: { orderBy: { order: "asc" } } },
    });
  }

  // -------------------------------------------------------------------------

  describe("eligibility", () => {
    it("enrols a lead that has gone quiet past the trigger", async () => {
      await makeSilentLead("هادئ", 72);
      const seq = await makeSequence({ triggerHours: 48 });
      expect(await lib.enrollEligible(seq.id)).toBe(1);
    });

    it("leaves a lead that is still inside the window", async () => {
      await makeSilentLead("حديث", 12);
      const seq = await makeSequence({ triggerHours: 48 });
      expect(await lib.enrollEligible(seq.id)).toBe(0);
    });

    it("never enrols the same lead twice", async () => {
      await makeSilentLead("مكرر", 72);
      const seq = await makeSequence();
      expect(await lib.enrollEligible(seq.id)).toBe(1);
      // Otherwise every hourly run would add another enrolment and the lead
      // would receive the sequence again from the top.
      expect(await lib.enrollEligible(seq.id)).toBe(0);
    });

    it("leaves a merged lead alone", async () => {
      const survivor = await makeSilentLead("الأصل", 72);
      const dupe = await makeSilentLead("مكرر", 72);
      await prisma.lead.update({ where: { id: dupe.id }, data: { mergedIntoLeadId: survivor.id } });

      const seq = await makeSequence();
      expect(await lib.enrollEligible(seq.id)).toBe(1);
    });

    it("leaves a won lead alone", async () => {
      const lead = await makeSilentLead("رابح", 72);
      const pipeline = await prisma.pipeline.create({
        data: { organizationId: orgId, name: "م", isDefault: true },
      });
      const stage = await prisma.pipelineStage.create({
        data: { pipelineId: pipeline.id, name: "بيع", order: 1, isWon: true },
      });
      await prisma.opportunity.create({
        data: { organizationId: orgId, leadId: lead.id, pipelineId: pipeline.id, stageId: stage.id },
      });

      // Chasing a closed deal is noise at best and embarrassing at worst.
      const seq = await makeSequence();
      expect(await lib.enrollEligible(seq.id)).toBe(0);
    });

    it("does not activate itself — a new sequence is paused", async () => {
      await makeSilentLead("منتظر", 72);
      const seq = await prisma.sequence.create({
        data: {
          organizationId: orgId,
          name: "غير مفعّل",
          triggerHours: 48,
          steps: { create: [{ order: 1, delayHours: 0, action: "SEND_MESSAGE", body: "لن يُرسل" }] },
        },
      });
      expect(await lib.enrollEligible(seq.id)).toBe(0);
    });
  });

  describe("the preview matches reality", () => {
    it("counts exactly the leads the run would enrol", async () => {
      await makeSilentLead("أ", 72);
      await makeSilentLead("ب", 72);
      await makeSilentLead("ج", 6); // inside the window
      const seq = await makeSequence({ triggerHours: 48 });

      // The screen and the job must not compute this two different ways.
      const preview = await lib.eligibleLeads(seq.id);
      expect(preview).toHaveLength(2);
      expect(await lib.enrollEligible(seq.id)).toBe(preview.length);
    });
  });

  describe("running steps", () => {
    it("sends the first step and advances to the second", async () => {
      await makeSilentLead("متابَع", 72);
      const seq = await makeSequence({
        steps: [
          { delayHours: 0, body: "الرسالة الأولى" },
          { delayHours: 48, body: "الرسالة الثانية" },
        ],
      });
      await lib.enrollEligible(seq.id);

      const result = await lib.runDueSteps();
      expect(result.sent).toBe(1);
      expect(sent[0].text).toBe("الرسالة الأولى");

      const enrolment = await prisma.sequenceEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
      expect(enrolment.status).toBe("ACTIVE");
      expect(enrolment.currentStepId).toBe(seq.steps[1].id);
    });

    it("records the message as SYSTEM, not as an agent", async () => {
      await makeSilentLead("مُرسَل", 72);
      const seq = await makeSequence();
      await lib.enrollEligible(seq.id);
      await lib.runDueSteps();

      // The inbox must not imply a colleague typed this.
      const msg = await prisma.message.findFirstOrThrow({
        where: { organizationId: orgId, direction: "OUTBOUND" },
      });
      expect(msg.senderType).toBe("SYSTEM");
      expect(msg.senderMemberId).toBeNull();
    });

    it("completes after the last step", async () => {
      await makeSilentLead("منتهٍ", 72);
      const seq = await makeSequence({ steps: [{ delayHours: 0, body: "وحيدة" }] });
      await lib.enrollEligible(seq.id);
      await lib.runDueSteps();

      const enrolment = await prisma.sequenceEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
      expect(enrolment.status).toBe("COMPLETED");
      expect(enrolment.nextRunAt).toBeNull();
    });

    it("stops a paused sequence mid-flight", async () => {
      await makeSilentLead("موقوف", 72);
      const seq = await makeSequence({
        steps: [
          { delayHours: 0, body: "أ" },
          { delayHours: 0, body: "ب" },
        ],
      });
      await lib.enrollEligible(seq.id);
      await lib.runDueSteps();
      sent.length = 0;

      await prisma.sequence.update({ where: { id: seq.id }, data: { isActive: false } });
      await prisma.sequenceEnrollment.updateMany({
        where: { sequenceId: seq.id },
        data: { nextRunAt: new Date(0), lastRunAt: null },
      });

      const result = await lib.runDueSteps();
      expect(result.sent).toBe(0);
      expect(sent).toHaveLength(0);
    });
  });

  describe("a reply ends it", () => {
    it("stops the moment the customer answers", async () => {
      const lead = await makeSilentLead("ردّ", 72);
      const seq = await makeSequence({
        steps: [
          { delayHours: 0, body: "أ" },
          { delayHours: 0, body: "ب" },
        ],
      });
      await lib.enrollEligible(seq.id);

      await prisma.message.create({
        data: {
          organizationId: orgId,
          conversationId: lead.conversationId!,
          direction: "INBOUND",
          senderType: "CUSTOMER",
          body: "نعم مهتم",
        },
      });

      const result = await lib.runDueSteps();
      // Continuing to send scripted messages to someone who is talking to you
      // is the fastest way to make this feel like spam.
      expect(result.stoppedByReply).toBe(1);
      expect(result.sent).toBe(0);
      expect(sent).toHaveLength(0);

      const enrolment = await prisma.sequenceEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
      expect(enrolment.status).toBe("STOPPED_REPLIED");
    });

    it("ignores our own outbound messages", async () => {
      const lead = await makeSilentLead("صادر", 72);
      const seq = await makeSequence();
      await lib.enrollEligible(seq.id);

      await prisma.message.create({
        data: {
          organizationId: orgId,
          conversationId: lead.conversationId!,
          direction: "OUTBOUND",
          senderType: "AGENT",
          body: "تذكير",
        },
      });

      // Only the customer speaking counts as a reply.
      expect(await lib.stopRepliedEnrollments()).toBe(0);
    });
  });

  describe("one message per lead per day", () => {
    it("holds across two different sequences", async () => {
      await makeSilentLead("مزدوج", 72);
      const a = await makeSequence({ steps: [{ delayHours: 0, body: "من التسلسل الأول" }] });
      const b = await makeSequence({ steps: [{ delayHours: 0, body: "من التسلسل الثاني" }] });
      await lib.enrollEligible(a.id);
      await lib.enrollEligible(b.id);

      const result = await lib.runDueSteps();
      // Two overlapping sequences must not be able to gang up on one person.
      expect(result.sent).toBe(1);
      expect(result.skipped).toBe(1);
      expect(sent).toHaveLength(1);
    });

    it("retries the held step later rather than dropping it", async () => {
      await makeSilentLead("مؤجل", 72);
      const a = await makeSequence({ steps: [{ delayHours: 0, body: "أولى" }] });
      const b = await makeSequence({ steps: [{ delayHours: 0, body: "ثانية" }] });
      await lib.enrollEligible(a.id);
      await lib.enrollEligible(b.id);
      await lib.runDueSteps();

      const held = await prisma.sequenceEnrollment.findFirstOrThrow({
        where: { status: "ACTIVE", lastRunAt: null },
      });
      expect(held.nextRunAt).not.toBeNull();
      expect(held.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("failure is never silent", () => {
    it("raises a notification and stops when there is no open conversation", async () => {
      const lead = await prisma.lead.create({
        data: {
          organizationId: orgId,
          fullName: "بلا محادثة",
          lastInteractionAt: new Date(Date.now() - 72 * 3600_000),
        },
      });
      const seq = await makeSequence();
      await lib.enrollEligible(seq.id);

      const result = await lib.runDueSteps();
      expect(result.failed).toBe(1);
      expect(sent).toHaveLength(0);

      const notif = await prisma.notification.findFirstOrThrow({ where: { organizationId: orgId } });
      expect(notif.type).toBe("SEQUENCE_STEP_FAILED");
      expect(notif.entityId).toBe(lead.id);

      const enrolment = await prisma.sequenceEnrollment.findFirstOrThrow({ where: { sequenceId: seq.id } });
      expect(enrolment.status).toBe("STOPPED_INELIGIBLE");
    });

    it("does not message a closed conversation", async () => {
      const lead = await makeSilentLead("مغلق", 72);
      await prisma.conversation.update({ where: { id: lead.conversationId! }, data: { status: "CLOSED" } });
      const seq = await makeSequence();
      await lib.enrollEligible(seq.id);

      const result = await lib.runDueSteps();
      expect(result.failed).toBe(1);
      expect(sent).toHaveLength(0);
    });
  });
});
