/**
 * Lead service: auto-creation from conversations + dedup (requirements §4.6).
 */
import { prisma } from "./db";
import { captureError } from "./monitoring";
import { applyScoringEvent } from "./scoring";
import { autoAssign } from "./distribution";

export async function findOrCreateLeadForConversation(conversationId: string) {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { lead: true, campaign: true },
  });
  if (conv.lead) return conv.lead;

  // Dedup by ig_user_id before creating
  const existingId = await prisma.leadIdentifier.findFirst({
    where: {
      kind: "ig_user_id",
      value: conv.customerExternalId,
      lead: { organizationId: conv.organizationId, mergedIntoLeadId: null },
    },
    include: { lead: true },
  });
  if (existingId) {
    await prisma.lead.update({
      where: { id: existingId.leadId },
      data: { conversationId: conv.id, lastInteractionAt: new Date() },
    });
    return existingId.lead;
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId: conv.organizationId,
      conversationId: conv.id,
      igUsername: conv.customerUsername,
      fullName: conv.customerName,
      campaignId: conv.campaignId,
      lastInteractionAt: new Date(),
    },
  });
  await prisma.leadIdentifier.create({
    data: { leadId: lead.id, kind: "ig_user_id", value: conv.customerExternalId },
  });

  await placeOnDefaultPipeline(lead.id, conv.organizationId);
  await autoAssign(lead.id);
  return lead;
}

/**
 * Put a new lead on the board.
 *
 * Manually created leads have always done this — `/api/leads` places them on
 * the default pipeline's first stage. Leads arriving from a conversation did
 * not, which meant the platform's *primary* source of business never reached
 * the pipeline at all: not on the board, not in the funnel, and contributing
 * nothing to the Pipeline value on the dashboard.
 *
 * Failing here must not fail message ingestion — a lead without a card is
 * recoverable, a dropped customer message is not.
 */
export async function placeOnDefaultPipeline(leadId: string, organizationId: string) {
  try {
    const existing = await prisma.opportunity.findFirst({ where: { leadId, archivedAt: null } });
    if (existing) return;

    const pipeline = await prisma.pipeline.findFirst({
      where: { organizationId, isDefault: true },
      include: { stages: { orderBy: { order: "asc" }, take: 1 } },
    });
    if (!pipeline?.stages[0]) return;

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { budgetMax: true } });

    await prisma.opportunity.create({
      data: {
        organizationId,
        leadId,
        pipelineId: pipeline.id,
        stageId: pipeline.stages[0].id,
        // The customer's stated ceiling is the only value estimate available
        // this early. It is refined when the deal is won.
        value: lead?.budgetMax ?? undefined,
      },
    });
  } catch (e) {
    captureError(e, { route: "leads.placeOnDefaultPipeline", leadId });
  }
}

/**
 * Apply extracted entities to a lead; each newly-learned field can trigger scoring.
 * Phone/email are also registered as identifiers → dedup candidates flagged, not auto-merged (§4.6).
 */
export async function updateLeadFromExtraction(
  leadId: string,
  extracted: {
    fullName?: string;
    phone?: string;
    email?: string;
    purpose?: "BUY" | "INVEST" | "RENT";
    city?: string;
    area?: string;
    propertyType?: string;
    budgetMin?: number;
    budgetMax?: number;
    paymentMethod?: string;
    buyTimeframe?: string;
  },
) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const data: Record<string, unknown> = {};
  const events: string[] = [];

  if (extracted.phone && !lead.phone) {
    data.phone = extracted.phone;
    events.push("PHONE_SHARED");
  }
  if (extracted.email && !lead.email) data.email = extracted.email;
  if (extracted.fullName && !lead.fullName) data.fullName = extracted.fullName;
  if (extracted.purpose && lead.purpose === "UNKNOWN") data.purpose = extracted.purpose;
  if ((extracted.area || extracted.city) && !lead.area && !lead.city) {
    data.area = extracted.area;
    data.city = extracted.city;
    events.push("AREA_PROVIDED");
  }
  if (extracted.propertyType && !lead.propertyType) data.propertyType = extracted.propertyType;
  if ((extracted.budgetMin || extracted.budgetMax) && !lead.budgetMin && !lead.budgetMax) {
    data.budgetMin = extracted.budgetMin;
    data.budgetMax = extracted.budgetMax;
    events.push("BUDGET_PROVIDED");
  }
  if (extracted.paymentMethod && !lead.paymentMethod) data.paymentMethod = extracted.paymentMethod;
  if (extracted.buyTimeframe && !lead.buyTimeframe) {
    data.buyTimeframe = extracted.buyTimeframe;
    if (/شهر|قريب|month|soon|أسبوع|week/i.test(extracted.buyTimeframe)) events.push("NEAR_TERM_PURCHASE");
  }

  if (Object.keys(data).length > 0) {
    data.lastInteractionAt = new Date();
    await prisma.lead.update({ where: { id: leadId }, data });
  }

  // The lead arrives with no budget, so its opportunity is created worth
  // nothing. The moment the customer states a ceiling, the card is worth that —
  // without this the Pipeline figure would only ever count leads someone typed
  // in by hand.
  if (data.budgetMax) {
    await prisma.opportunity.updateMany({
      where: { leadId, archivedAt: null, value: null },
      data: { value: data.budgetMax as number },
    });
  }

  for (const kind of ["phone", "email"] as const) {
    const value = extracted[kind];
    if (value) {
      await prisma.leadIdentifier.upsert({
        where: { kind_value_leadId: { kind, value, leadId } },
        create: { leadId, kind, value },
        update: {},
      });
    }
  }

  for (const event of events) await applyScoringEvent(leadId, event);
  return events;
}

/** Duplicate candidates for manual merge review (§4.6 — never auto-merge). */
export async function findDuplicateCandidates(organizationId: string, leadId: string) {
  const ids = await prisma.leadIdentifier.findMany({ where: { leadId } });
  if (ids.length === 0) return [];
  return prisma.leadIdentifier.findMany({
    where: {
      leadId: { not: leadId },
      OR: ids.map((i) => ({ kind: i.kind, value: i.value })),
      lead: { organizationId, mergedIntoLeadId: null },
    },
    include: { lead: { select: { id: true, fullName: true, igUsername: true, phone: true, score: true } } },
  });
}
