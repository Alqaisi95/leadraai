/**
 * Conversation service: message ingestion, state machine, reply guard.
 * State machine (requirements §4.4) — allowed transitions only.
 */
import { prisma } from "./db";
import { sendInstagramMessage } from "./meta";
import type { TenantContext } from "./tenant";
import { TenantMismatchError } from "./tenant";
import { audit } from "./audit";

type ConvStatus =
  | "AI_ACTIVE" | "NEEDS_HUMAN" | "ASSIGNED_TO_AGENT"
  | "AGENT_ACTIVE" | "FOLLOW_UP_PENDING" | "CLOSED" | "SPAM";

const TRANSITIONS: Record<ConvStatus, ConvStatus[]> = {
  AI_ACTIVE: ["NEEDS_HUMAN", "ASSIGNED_TO_AGENT", "AGENT_ACTIVE", "FOLLOW_UP_PENDING", "CLOSED", "SPAM"],
  NEEDS_HUMAN: ["ASSIGNED_TO_AGENT", "AGENT_ACTIVE", "CLOSED", "SPAM"],
  ASSIGNED_TO_AGENT: ["AGENT_ACTIVE", "NEEDS_HUMAN", "FOLLOW_UP_PENDING", "CLOSED", "SPAM"],
  AGENT_ACTIVE: ["FOLLOW_UP_PENDING", "CLOSED", "AI_ACTIVE", "SPAM", "ASSIGNED_TO_AGENT"],
  FOLLOW_UP_PENDING: ["AGENT_ACTIVE", "AI_ACTIVE", "CLOSED", "SPAM"],
  CLOSED: ["AI_ACTIVE", "AGENT_ACTIVE"],
  SPAM: ["AI_ACTIVE"],
};

export async function transition(conversationId: string, to: ConvStatus, ctx?: TenantContext) {
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  if (ctx && conv.organizationId !== ctx.organizationId) throw new TenantMismatchError();
  const from = conv.status as ConvStatus;
  if (from === to) return conv;
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new Error(`INVALID_TRANSITION: ${from} → ${to}`);
  }
  const updated = await prisma.conversation.update({ where: { id: conversationId }, data: { status: to } });
  if (ctx) {
    await audit({ ctx, action: "conversation.transition", entityType: "conversation", entityId: conversationId, before: { status: from }, after: { status: to } });
  }
  return updated;
}

/** Upsert conversation + insert inbound message (idempotent). Called by the worker. */
export async function ingestInboundMessage(params: {
  organizationId: string;
  integrationId: string;
  threadId: string;
  igUserId: string;
  igUsername?: string;
  messageId: string;
  text?: string;
  attachments?: unknown[];
}) {
  const conversation = await prisma.conversation.upsert({
    where: { integrationId_externalThreadId: { integrationId: params.integrationId, externalThreadId: params.threadId } },
    create: {
      organizationId: params.organizationId,
      integrationId: params.integrationId,
      externalThreadId: params.threadId,
      customerExternalId: params.igUserId,
      customerUsername: params.igUsername,
      status: "AI_ACTIVE",
      lastMessageAt: new Date(),
      unreadCount: 1,
    },
    update: { lastMessageAt: new Date(), unreadCount: { increment: 1 } },
  });

  let created = false;
  try {
    await prisma.message.create({
      data: {
        organizationId: params.organizationId,
        conversationId: conversation.id,
        externalMessageId: params.messageId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        body: params.text,
        attachments: params.attachments ? (params.attachments as object) : undefined,
      },
    });
    created = true;
  } catch (e: any) {
    if (e?.code !== "P2002") throw e; // duplicate message → already ingested
  }

  return { conversation, messageCreated: created };
}

/**
 * Agent reply — the AI/human collision guard (§4.4):
 * an agent reply immediately moves the conversation to AGENT_ACTIVE,
 * and the AI orchestrator refuses to answer any conversation not in AI_ACTIVE.
 */
export async function sendAgentReply(ctx: TenantContext, conversationId: string, text: string) {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: ctx.organizationId },
  });
  if (!conv) throw new TenantMismatchError();

  if (["CLOSED", "SPAM"].includes(conv.status)) throw new Error("CONVERSATION_NOT_OPEN");

  // claim the conversation first — blocks concurrent AI reply
  if (conv.status !== "AGENT_ACTIVE") await transition(conv.id, "AGENT_ACTIVE", ctx);

  const sent = await sendInstagramMessage(conv.integrationId, conv.customerExternalId, text);

  const message = await prisma.message.create({
    data: {
      organizationId: ctx.organizationId,
      conversationId: conv.id,
      externalMessageId: sent.message_id,
      direction: "OUTBOUND",
      senderType: "AGENT",
      senderMemberId: ctx.memberId,
      body: text,
      deliveredAt: new Date(),
    },
  });

  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
  return message;
}
