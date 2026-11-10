/**
 * Queue processing core — shared between:
 *  - worker/index.ts        (long-running process: VPS / Railway)
 *  - /api/worker/drain      (serverless: Vercel Cron / external pinger)
 * Same logic, two runtimes.
 */
import { prisma } from "./db";
import { ingestInboundMessage } from "./conversations";
import { handleInboundWithAi } from "./ai/orchestrator";
import { describeAttachments, summarizeAttachments, type DescribedAttachment } from "./attachments";

const MAX_ATTEMPTS = 5;

async function claimNext(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE webhook_events SET status = 'PROCESSING', attempts = attempts + 1
    WHERE id = (
      SELECT id FROM webhook_events
      WHERE status = 'QUEUED' AND "externalEventId" NOT LIKE 'oauth_state:%'
      ORDER BY "receivedAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

async function processEvent(eventId: string) {
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  const payload = event.rawPayload as any;
  const messaging = payload.messaging;
  const igBusinessId = payload.entryId as string;

  const integration = await prisma.integration.findFirst({
    where: { provider: "INSTAGRAM", externalId: igBusinessId, status: "CONNECTED" },
  });
  if (!integration) throw new Error(`NO_INTEGRATION_FOR ${igBusinessId}`);
  if (messaging.message?.is_echo) return;

  // R3.2 — attribute conversation to a campaign from IG ad referral
  let campaignId: string | undefined;
  const ref = messaging.referral ?? messaging.postback?.referral;
  if (ref?.ad_id || ref?.ref) {
    const adId = String(ref.ad_id ?? ref.ref);
    let campaign = await prisma.campaign.findFirst({
      where: { organizationId: integration.organizationId, adId },
    });
    if (!campaign) {
      campaign = await prisma.campaign.create({
        data: {
          organizationId: integration.organizationId,
          name: ref.ads_context_data?.ad_title ?? `Instagram Ad ${adId}`,
          source: "PAID",
          adId,
          utm: ref.ref ? { ref: ref.ref } : undefined,
        },
      });
    }
    campaignId = campaign.id;
  }

  const { conversation, messageCreated } = await ingestInboundMessage({
    organizationId: integration.organizationId,
    integrationId: integration.id,
    threadId: messaging.sender.id,
    igUserId: messaging.sender.id,
    messageId: messaging.message?.mid ?? event.externalEventId,
    text: messaging.message?.text,
    attachments: messaging.message?.attachments,
  });

  if (campaignId && !conversation.campaignId) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { campaignId } });
    const lead = await prisma.lead.findUnique({ where: { conversationId: conversation.id } });
    if (lead && !lead.campaignId) {
      await prisma.lead.update({ where: { id: lead.id }, data: { campaignId } });
    }
  }

  if (!messageCreated) return;

  if (messaging.message?.text) {
    await handleInboundWithAi(conversation.id);
    return;
  }

  // No text. Until now this returned here and the customer got nothing back at
  // all — a voice note or a photo simply vanished from their point of view, and
  // the agent saw an empty bubble with no indication anything had been sent.
  //
  // The assistant still must not answer: nothing is transcribed, so any reply
  // would be invented. So the conversation goes to a human, loudly.
  const described = describeAttachments(messaging.message?.attachments);
  if (described.length > 0) {
    await escalateUnreadableMessage(conversation.id, described);
  }
}

/**
 * Hand a non-text message to a person.
 *
 * Mirrors the handoff the orchestrator performs for low confidence: same status
 * transition, same notification shape, so the inbox and the reports treat it
 * identically to any other escalation.
 */
async function escalateUnreadableMessage(conversationId: string, described: DescribedAttachment[]) {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    select: { id: true, organizationId: true, status: true, lead: { select: { ownerMemberId: true } } },
  });

  // An agent already working this conversation does not need it reassigned.
  if (conv.status === "AI_ACTIVE") {
    await prisma.conversation.update({ where: { id: conv.id }, data: { status: "NEEDS_HUMAN" } });
  }

  await prisma.notification.create({
    data: {
      organizationId: conv.organizationId,
      recipientMemberId: conv.lead?.ownerMemberId ?? null,
      type: "HUMAN_REQUESTED",
      title: `${summarizeAttachments(described)} تحتاج ردًا بشريًا`,
      body: "المساعد الآلي لا يقرأ المرفقات بعد، والمحادثة بانتظار موظف.",
      entityType: "conversation",
      entityId: conv.id,
    },
  });
}

async function markFailure(eventId: string, error: unknown) {
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  const dead = event.attempts >= MAX_ATTEMPTS;
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: dead ? "DEAD_LETTER" : "QUEUED", lastError: String(error).slice(0, 500) },
  });
  if (dead) {
    const igId = (event.rawPayload as any)?.entryId;
    const integration = igId
      ? await prisma.integration.findFirst({ where: { provider: "INSTAGRAM", externalId: igId } })
      : null;
    if (integration) {
      await prisma.notification.create({
        data: {
          organizationId: integration.organizationId,
          type: "WEBHOOK_FAILED",
          title: "فشل معالجة رسالة واردة",
          body: `Event ${event.externalEventId} — يحتاج إعادة تشغيل يدوية`,
        },
      });
    }
  }
  return dead;
}

/** Process up to `limit` queued events. Returns counts. Safe to call concurrently. */
export async function processBatch(limit = 10) {
  let processed = 0,
    failed = 0,
    dead = 0;
  for (let i = 0; i < limit; i++) {
    const eventId = await claimNext();
    if (!eventId) break;
    try {
      await processEvent(eventId);
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { status: "PROCESSED", processedAt: new Date(), lastError: null },
      });
      processed++;
    } catch (e) {
      failed++;
      if (await markFailure(eventId, e)) dead++;
    }
  }
  return { processed, failed, dead };
}
