/**
 * Every lead reaches the pipeline.
 *
 * A lead created by hand through `/api/leads` has always been placed on the
 * default pipeline's first stage. A lead arriving from a conversation — the
 * platform's primary source of business, and the entire point of the Instagram
 * integration — was not. The consequence was not subtle: those leads never
 * appeared on the board, never entered the funnel, and contributed nothing to
 * the Pipeline value on the dashboard, so the headline number described only
 * the leads someone had typed in manually.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — pipeline placement must not be skipped");
}

vi.mock("@/lib/meta", () => ({ sendInstagramMessage: async () => ({ message_id: "x" }) }));

describe.skipIf(!HAS_DB)("Pipeline placement", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let leads: typeof import("@/lib/leads");
  let orgId: string;
  let integrationId: string;
  let firstStageId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    leads = await import("@/lib/leads");
  });

  beforeEach(async () => {
    await prisma.organization.deleteMany({ where: { name: { startsWith: "place-test-" } } });
    const org = await prisma.organization.create({ data: { name: `place-test-${Date.now()}` } });
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

    const pipeline = await prisma.pipeline.create({
      data: { organizationId: orgId, name: "الافتراضي", isDefault: true },
    });
    const stage = await prisma.pipelineStage.create({
      data: { pipelineId: pipeline.id, name: "جديد", order: 1 },
    });
    firstStageId = stage.id;
  });

  async function conversationLead(tag: string) {
    const conv = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        integrationId,
        externalThreadId: `t-${tag}-${Date.now()}`,
        customerExternalId: `c-${tag}-${Date.now()}`,
        customerUsername: tag,
      },
    });
    return leads.findOrCreateLeadForConversation(conv.id);
  }

  it("puts a conversation lead on the board", async () => {
    const lead = await conversationLead("قادم-من-انستغرام");

    const opp = await prisma.opportunity.findFirst({ where: { leadId: lead.id } });
    expect(opp).not.toBeNull();
    expect(opp!.stageId).toBe(firstStageId);
  });

  it("creates exactly one opportunity however many times it is called", async () => {
    const conv = await prisma.conversation.create({
      data: {
        organizationId: orgId,
        integrationId,
        externalThreadId: `t-once-${Date.now()}`,
        customerExternalId: `c-once-${Date.now()}`,
      },
    });
    const first = await leads.findOrCreateLeadForConversation(conv.id);
    await leads.findOrCreateLeadForConversation(conv.id);
    await leads.placeOnDefaultPipeline(first.id, orgId);

    // Every inbound message runs through this path; a second card per message
    // would make the board unusable within an hour.
    expect(await prisma.opportunity.count({ where: { leadId: first.id } })).toBe(1);
  });

  it("starts worth nothing, then takes the budget the customer states", async () => {
    const lead = await conversationLead("ميزانية");
    expect((await prisma.opportunity.findFirstOrThrow({ where: { leadId: lead.id } })).value).toBeNull();

    await leads.updateLeadFromExtraction(lead.id, { budgetMin: 90_000, budgetMax: 150_000 });

    const opp = await prisma.opportunity.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(Number(opp.value)).toBe(150_000);
  });

  it("does not overwrite a value someone set deliberately", async () => {
    const lead = await conversationLead("محدد");
    await prisma.opportunity.updateMany({ where: { leadId: lead.id }, data: { value: 500_000 } });

    // A number entered by a person beats one inferred from chat.
    await leads.updateLeadFromExtraction(lead.id, { budgetMax: 150_000 });

    const opp = await prisma.opportunity.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(Number(opp.value)).toBe(500_000);
  });

  it("survives an organization with no default pipeline", async () => {
    await prisma.pipeline.updateMany({ where: { organizationId: orgId }, data: { isDefault: false } });

    // Placement failing must never fail message ingestion — a lead without a
    // card is recoverable; a dropped customer message is not.
    const lead = await conversationLead("بلا-مسار");
    expect(lead).toBeTruthy();
    expect(await prisma.opportunity.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("counts toward the dashboard's pipeline value", async () => {
    const lead = await conversationLead("قيمة");
    await leads.updateLeadFromExtraction(lead.id, { budgetMax: 200_000 });

    // The same aggregate the overview endpoint runs: open stages only.
    const agg = await prisma.opportunity.aggregate({
      where: { organizationId: orgId, archivedAt: null, stage: { isWon: false, isLost: false } },
      _sum: { value: true },
    });
    expect(Number(agg._sum.value)).toBe(200_000);
  });
});
