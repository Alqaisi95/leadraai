/**
 * Queue processing core — shared between:
 *  - worker/index.ts        (long-running process: VPS / Railway)
 *  - /api/worker/drain      (serverless: Vercel Cron / external pinger)
 * Same logic, two runtimes.
 */
import { prisma } from "./db";
import { ingestInboundMessage } from "./conversations";
import { handleInboundWithAi } from "./ai/orchestrator";

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
          source: "PAID", adId,
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

  if (messageCreated && messaging.message?.text) {
    await handleInboundWithAi(conversation.id);
  }
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
  let processed = 0, failed = 0, dead = 0;
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
