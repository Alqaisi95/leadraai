/** Agent-facing AI: draft a reply or summarize the thread. Never sends anything. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { AiUnavailableError, suggestReply, summarizeConversation, toAiError } from "@/lib/ai/assist";

const schema = z.object({
  mode: z.enum(["suggest", "summary"]),
  instruction: z.string().max(500).optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "conversations.reply");
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "mode must be suggest | summary", correlationId);

  try {
    const result =
      body.data.mode === "suggest"
        ? await suggestReply(id, ctx.organizationId, body.data.instruction)
        : await summarizeConversation(id, ctx.organizationId);
    return NextResponse.json(result);
  } catch (e) {
    // any provider failure is operational, not a bug — tell the operator which
    const ai = e instanceof AiUnavailableError ? e : toAiError(e);
    const status = ai.code === "RATE_LIMITED" ? 429 : 503;
    return err(status, `AI_${ai.code}`, ai.arabic, correlationId);
  }
});
