/**
 * GET /api/conversations/:id/ai-runs — every AI decision in a conversation:
 * what it was asked (summary), what it answered, its confidence, the knowledge
 * it used, and why it handed off. Same agent scope as the conversation itself.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import type { AiRunDetails } from "@/lib/ai/respond";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "conversations.read");
  const id = new URL(req.url).pathname.split("/").at(-2)!;

  const conv = await prisma.conversation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!conv) throw new TenantMismatchError();
  if (ctx.role === "AGENT" && conv.assignedMemberId && conv.assignedMemberId !== ctx.memberId) throw new TenantMismatchError();

  const runs = await prisma.aiRun.findMany({
    where: { conversationId: id, organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { promptVersion: { select: { name: true, version: true } } },
  });

  return NextResponse.json({
    items: runs.map((r: any) => {
      // ai_runs.sources: an object since Phase 2 (AiRunDetails), a plain list of chunks before
      const raw = r.sources;
      const details: Partial<AiRunDetails> = Array.isArray(raw) ? { chunks: raw } : (raw ?? {});
      return {
        id: r.id,
        createdAt: r.createdAt,
        input: r.inputSummary,
        output: r.outputSummary,
        confidence: r.confidence,
        handedOff: r.handedOff,
        reason: details.reason ?? (r.error === "blocked_by_price_guard" ? "price_guard" : null),
        error: r.error && r.error !== "blocked_by_price_guard" ? r.error : null,
        sources: (details.chunks ?? []).map((c: any) => c.title).filter(Boolean),
        terms: details.terms ?? [],
        intent: details.intent ?? null,
        model: details.model ?? null,
        tokens: details.usage ? details.usage.input + details.usage.output : null,
        latencyMs: r.latencyMs,
        prompt: r.promptVersion ? `${r.promptVersion.name} v${r.promptVersion.version}` : null,
      };
    }),
  });
});
