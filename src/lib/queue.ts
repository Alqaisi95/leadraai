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
    UPDATE webhook_events SET status = 'PROCESSING', attempts = attempts + 1, "claimedAt" = now()
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
  // The event arrives knowing only an Instagram id. Recording which tenant it
  // turned out to belong to is what lets that tenant see — and retry — it if
  // it later fails; without the stamp a failed event belongs to no one.
  if (!event.organizationId) {
    await prisma.webhookEvent.update({
      where: { id: eventId },
      data: { organizationId: integration.organizationId },
    });
  }
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

  if (!messageCreated) {
    // The message is already stored. On a first attempt that means Meta
    // delivered it twice and there is nothing to do. On a retry it means the
    // previous attempt died *after* storing the message — and returning here,
    // as this used to, marked the event PROCESSED with the customer never
    // answered and no one told. Pick the work back up if it was left undone.
    const messageId = messaging.message?.mid ?? event.externalEventId;
    if (event.attempts <= 1 || !(await isUnanswered(conversation.id, messageId))) return;
  }

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
      if (!event.organizationId) {
        await prisma.webhookEvent.update({
          where: { id: eventId },
          data: { organizationId: integration.organizationId },
        });
      }
      await prisma.notification.create({
        data: {
          organizationId: integration.organizationId,
          type: "WEBHOOK_FAILED",
          title: "فشل معالجة رسالة واردة",
          body: "تعذّرت معالجة رسالة من عميل بعد خمس محاولات. أعد المحاولة من مركز التكاملات.",
        },
      });
    }
  }
  return dead;
}

/**
 * True when the stored inbound message is still the last word in its
 * conversation and the assistant still owns it — i.e. an earlier attempt stored
 * the message and then died before replying or handing off.
 *
 * Any later message means the conversation moved on (a reply went out, the
 * customer wrote again and that event will be handled on its own), and any
 * status other than AI_ACTIVE means a person or a handoff already has it.
 */
async function isUnanswered(conversationId: string, externalMessageId: string): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { status: true },
  });
  if (conv?.status !== "AI_ACTIVE") return false;
  const last = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { externalMessageId: true, direction: true },
  });
  return last?.direction === "INBOUND" && last.externalMessageId === externalMessageId;
}

/**
 * How long a claim may stand before its worker is presumed dead.
 *
 * Longer than any invocation can live — the drain route is capped at 60s and
 * Workers gives background work 30s — so a claim older than this is not slow,
 * it is orphaned.
 */
export const STALL_AFTER_MS = 5 * 60 * 1000;

/**
 * Take back events whose worker died mid-flight.
 *
 * Requeued events keep their attempt count, so a message that reliably kills
 * its worker still reaches the dead-letter queue — and the notification that
 * goes with it — instead of looping forever.
 */
export async function reclaimStalled(now = new Date()) {
  const cutoff = new Date(now.getTime() - STALL_AFTER_MS);
  const stalled = await prisma.webhookEvent.findMany({
    where: { status: "PROCESSING", OR: [{ claimedAt: { lt: cutoff } }, { claimedAt: null }] },
    select: { id: true },
    take: 50,
  });
  let requeued = 0,
    dead = 0;
  for (const { id } of stalled) {
    if (await markFailure(id, "STALLED: worker stopped before finishing")) dead++;
    else requeued++;
  }
  return { requeued, dead };
}

/** Process up to `limit` queued events. Returns counts. Safe to call concurrently. */
export async function processBatch(limit = 10) {
  let processed = 0,
    failed = 0,
    dead = 0;
  // A failure to sweep must not stop fresh messages from being handled.
  const reclaimed = await reclaimStalled().catch(() => ({ requeued: 0, dead: 0 }));
  dead += reclaimed.dead;
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
  return { processed, failed, dead, reclaimed: reclaimed.requeued };
}

/**
 * Dead-lettered events of one tenant, newest first, shaped for an operator.
 *
 * The raw payload is not returned: it is Meta's envelope, and the screen needs
 * only who wrote, a glimpse of what, and why it failed.
 */
export async function listDeadLetters(organizationId: string, take = 50) {
  const events = await prisma.webhookEvent.findMany({
    where: { organizationId, status: "DEAD_LETTER" },
    orderBy: { receivedAt: "desc" },
    take,
  });
  return events.map((e) => {
    const messaging = (e.rawPayload as any)?.messaging;
    const text: string | undefined = messaging?.message?.text;
    return {
      id: e.id,
      receivedAt: e.receivedAt,
      attempts: e.attempts,
      lastError: e.lastError,
      senderId: (messaging?.sender?.id as string | undefined) ?? null,
      preview: text ? text.slice(0, 120) : null,
      hasAttachments:
        Array.isArray(messaging?.message?.attachments) && messaging.message.attachments.length > 0,
    };
  });
}

/**
 * Put a dead-lettered event back on the queue with a fresh set of attempts.
 *
 * Scoped by organisation in the same statement that changes the row, so an id
 * from another tenant — or one that is not dead-lettered — changes nothing.
 * Returns whether a row was requeued.
 */
export async function requeueDeadLetter(organizationId: string, id: string): Promise<boolean> {
  const { count } = await prisma.webhookEvent.updateMany({
    where: { id, organizationId, status: "DEAD_LETTER" },
    data: { status: "QUEUED", attempts: 0, lastError: null, claimedAt: null },
  });
  return count === 1;
}
