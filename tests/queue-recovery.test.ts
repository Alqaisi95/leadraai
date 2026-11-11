/**
 * No customer message is dropped by the queue.
 *
 * Two ways one used to be, both silent:
 *
 *   1. The worker died mid-event. The row stayed PROCESSING forever — never
 *      retried, never dead-lettered, no notification.
 *
 *   2. An attempt failed *after* storing the message. The retry found the
 *      message already there, took that for a duplicate delivery, and marked
 *      the event PROCESSED. The customer was never answered and never handed
 *      to a person.
 *
 * The organisation here has no subscription on purpose: the orchestrator then
 * hands the conversation to a human instead of calling the model, which gives
 * a real, observable "this message was dealt with" without mocking the AI.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;

if (process.env.CI && !HAS_DB) {
  throw new Error("TEST_DATABASE_URL is required in CI — queue recovery must not be skipped");
}

vi.mock("@/lib/meta", () => ({ sendInstagramMessage: async () => ({ message_id: "x" }) }));

describe.skipIf(!HAS_DB)("Queue recovery", () => {
  let prisma: typeof import("@/lib/db").prisma;
  let queue: typeof import("@/lib/queue");
  let conversations: typeof import("@/lib/conversations");
  let orgId: string;
  let integrationId: string;
  let igId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    ({ prisma } = await import("@/lib/db"));
    queue = await import("@/lib/queue");
    conversations = await import("@/lib/conversations");
  });

  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany({ where: { externalEventId: { startsWith: "qt-" } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: "queue-test-" } } });
    const org = await prisma.organization.create({ data: { name: `queue-test-${Date.now()}` } });
    orgId = org.id;
    igId = `ig-qt-${Date.now()}`;
    const integ = await prisma.integration.create({
      data: { organizationId: orgId, provider: "INSTAGRAM", status: "CONNECTED", externalId: igId },
    });
    integrationId = integ.id;
  });

  function payload(mid: string, sender: string) {
    return { entryId: igId, messaging: { sender: { id: sender }, message: { mid, text: "كم سعر الشقة؟" } } };
  }

  async function queued(mid: string, sender: string, attempts: number) {
    return prisma.webhookEvent.create({
      data: {
        provider: "INSTAGRAM",
        externalEventId: mid,
        rawPayload: payload(mid, sender),
        status: "QUEUED",
        attempts,
      },
    });
  }

  /** What an attempt leaves behind when it dies after storing the message. */
  async function storeMessage(mid: string, sender: string) {
    const { conversation } = await conversations.ingestInboundMessage({
      organizationId: orgId,
      integrationId,
      threadId: sender,
      igUserId: sender,
      messageId: mid,
      text: "كم سعر الشقة؟",
    });
    return conversation.id;
  }

  describe("stalled claims", () => {
    async function processing(mid: string, attempts: number, claimedAgoMs: number | null) {
      return prisma.webhookEvent.create({
        data: {
          provider: "INSTAGRAM",
          externalEventId: mid,
          rawPayload: payload(mid, "s"),
          status: "PROCESSING",
          attempts,
          claimedAt: claimedAgoMs === null ? null : new Date(Date.now() - claimedAgoMs),
        },
      });
    }

    it("requeues an event whose worker died", async () => {
      const ev = await processing("qt-stalled", 1, queue.STALL_AFTER_MS + 60_000);
      await queue.reclaimStalled();
      const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(after.status).toBe("QUEUED");
      expect(after.lastError).toMatch(/^STALLED/);
    });

    it("leaves a claim that is still inside the window alone", async () => {
      const ev = await processing("qt-fresh", 1, 5_000);
      await queue.reclaimStalled();
      const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(after.status).toBe("PROCESSING");
    });

    it("reclaims a claim from before the timestamp existed", async () => {
      const ev = await processing("qt-legacy", 1, null);
      await queue.reclaimStalled();
      const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(after.status).toBe("QUEUED");
    });

    it("dead-letters an event that keeps killing its worker, and says so", async () => {
      const ev = await processing("qt-poison", 5, queue.STALL_AFTER_MS + 60_000);
      const result = await queue.reclaimStalled();
      const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(after.status).toBe("DEAD_LETTER");
      expect(result.dead).toBeGreaterThanOrEqual(1);
      const note = await prisma.notification.findFirst({
        where: { organizationId: orgId, type: "WEBHOOK_FAILED" },
      });
      expect(note).not.toBeNull();
    });
  });

  describe("a retry after the message was already stored", () => {
    it("finishes the work instead of calling it a duplicate", async () => {
      const convId = await storeMessage("qt-resume", "sender-resume");
      const ev = await queued("qt-resume", "sender-resume", 1); // one attempt already spent

      await queue.processBatch(10);

      const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(after.status).toBe("PROCESSED");
      const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      // Dealt with: no subscription, so the assistant handed it to a person.
      expect(conv.status).toBe("NEEDS_HUMAN");
    });

    it("still treats a first-attempt duplicate as a duplicate", async () => {
      const convId = await storeMessage("qt-dup", "sender-dup");
      const ev = await queued("qt-dup", "sender-dup", 0); // Meta delivered it twice

      await queue.processBatch(10);

      const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(after.status).toBe("PROCESSED");
      const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(conv.status).toBe("AI_ACTIVE");
    });

    it("does not reopen a conversation a person already took", async () => {
      const convId = await storeMessage("qt-taken", "sender-taken");
      await prisma.conversation.update({ where: { id: convId }, data: { status: "AGENT_ACTIVE" } });
      const ev = await queued("qt-taken", "sender-taken", 1);

      await queue.processBatch(10);

      const after = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
      expect(after.status).toBe("PROCESSED");
      const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: convId } });
      expect(conv.status).toBe("AGENT_ACTIVE");
    });
  });
});
