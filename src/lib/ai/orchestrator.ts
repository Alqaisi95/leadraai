/**
 * AI Orchestrator (§4.5): message → RAG → generation → safety gates → send or handoff.
 * Runs ONLY from the worker, never inside the webhook request.
 * Refuses any conversation not in AI_ACTIVE (collision guard with agents).
 */
import { prisma } from "../db";
import { transition } from "../conversations";
import { sendInstagramMessage } from "../meta";
import { findOrCreateLeadForConversation, updateLeadFromExtraction } from "../leads";
import { applyScoringEvent } from "../scoring";
import { searchKnowledge, queryConcepts } from "./knowledge";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT_NAME } from "./prompts";
import { draftReply, retrievalQuery, type AiRunDetails } from "./respond";
import { aiAllowed } from "../billing";

export async function handleInboundWithAi(conversationId: string) {
  const started = Date.now();
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { organization: true, integration: true },
  });

  // collision guard — agent already active or handed off
  if (conv.status !== "AI_ACTIVE") return { skipped: true as const, reason: conv.status };

  // R2.2 — plan limit: pause AI gracefully, keep humans in the loop
  const billing = await aiAllowed(conv.organizationId);
  if (!billing.allowed) {
    await transition(conv.id, "NEEDS_HUMAN");
    await prisma.notification.create({
      data: {
        organizationId: conv.organizationId, type: "SLA_WARNING",
        title: "تم إيقاف الرد الآلي — حد الباقة",
        body: "وصلت مؤسستك حد الاستهلاك الشهري. المحادثات تتحول للموظفين. رقِّ الباقة لإعادة تفعيل AI.",
        entityType: "conversation", entityId: conv.id,
      },
    });
    return { skipped: true as const, reason: "plan_limit" };
  }

  const lead = await findOrCreateLeadForConversation(conv.id);

  const history = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const lastCustomerMsg = history.find((m) => m.senderType === "CUSTOMER")?.body ?? "";
  const chronological = [...history].reverse().map((m) => ({ role: m.senderType, text: m.body ?? "" }));
  // follow-ups like "وكم المقدم؟" only make sense with the previous question
  const query = retrievalQuery(chronological);

  // context: knowledge + LIVE inventory (single source of truth)
  const knowledgeChunks = await searchKnowledge(conv.organizationId, query, lead.interestedProjectId);
  const units = await prisma.unit.findMany({
    where: {
      organizationId: conv.organizationId,
      status: "AVAILABLE",
      ...(lead.interestedProjectId ? { projectId: lead.interestedProjectId } : {}),
    },
    include: { project: { select: { name: true } } },
    take: 10,
    orderBy: { updatedAt: "desc" },
  });
  const inventory = units.map((u) => ({
    unitNumber: u.unitNumber, project: u.project.name, type: u.unitType,
    bedrooms: u.bedrooms, areaSqm: u.areaSqm?.toString() ?? null, price: u.price?.toString() ?? null,
  }));

  // active prompt version (seeded default if none)
  let promptVersion = await prisma.promptVersion.findFirst({
    where: { organizationId: conv.organizationId, name: DEFAULT_SYSTEM_PROMPT_NAME, isActive: true },
  });
  if (!promptVersion) {
    promptVersion = await prisma.promptVersion.create({
      data: { organizationId: conv.organizationId, name: DEFAULT_SYSTEM_PROMPT_NAME, version: 1, content: DEFAULT_SYSTEM_PROMPT, isActive: true },
    });
  }

  const systemPrompt = promptVersion.content.replace("{{ORG_NAME}}", conv.organization.name);
  const draft = await draftReply({ systemPrompt, history: chronological, knowledgeChunks, inventory });
  const { ai, decision } = draft;

  // audit the run (never full message bodies)
  const details: AiRunDetails = {
    chunks: knowledgeChunks.map((c) => ({ sourceId: c.sourceId, title: c.sourceTitle })),
    reason: decision.reason,
    model: draft.model,
    usage: draft.usage,
    // search terms only, not the raw message (which may contain phone numbers etc.)
    terms: queryConcepts(query).map((c) => c[0]),
    intent: ai?.intent ?? null,
  };
  await prisma.aiRun.create({
    data: {
      organizationId: conv.organizationId,
      conversationId: conv.id,
      promptVersionId: promptVersion.id,
      runType: "RESPONSE",
      inputSummary: lastCustomerMsg.slice(0, 120),
      outputSummary: ai?.reply?.slice(0, 120) ?? null,
      confidence: ai?.confidence ?? null,
      sources: details as object,
      handedOff: decision.handoff,
      latencyMs: Date.now() - started,
      costUsd: draft.costUsd ?? undefined,
      error: draft.error ?? (decision.reason === "price_guard" ? "blocked_by_price_guard" : null),
    },
  });

  // entity extraction → lead update → scoring
  if (ai?.extracted) {
    await updateLeadFromExtraction(lead.id, ai.extracted as any).catch(() => {});
  }
  if (ai?.intent === "spam") {
    await applyScoringEvent(lead.id, "SPAM_MESSAGE");
    await transition(conv.id, "SPAM");
    return { skipped: false as const, handoff: false, spam: true };
  }

  if (decision.handoff) {
    await transition(conv.id, "NEEDS_HUMAN");
    await prisma.notification.create({
      data: {
        organizationId: conv.organizationId,
        recipientMemberId: lead.ownerMemberId,
        type: decision.reason === "complaint" ? "COMPLAINT" : "HUMAN_REQUESTED",
        title: decision.reason === "complaint" ? "شكوى تحتاج تدخلاً" : "محادثة تحتاج موظفاً",
        body: `السبب: ${decision.reason}`,
        entityType: "conversation",
        entityId: conv.id,
      },
    });
    return { skipped: false as const, handoff: true, reason: decision.reason };
  }

  // send AI reply
  const sent = await sendInstagramMessage(conv.integrationId, conv.customerExternalId, ai!.reply);
  await prisma.message.create({
    data: {
      organizationId: conv.organizationId,
      conversationId: conv.id,
      externalMessageId: sent.message_id,
      direction: "OUTBOUND",
      senderType: "AI",
      body: ai!.reply,
      deliveredAt: new Date(),
    },
  });
  await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });

  return { skipped: false as const, handoff: false };
}
