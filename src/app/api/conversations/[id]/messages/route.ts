import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { sendAgentReply } from "@/lib/conversations";
import { TenantMismatchError } from "@/lib/tenant";
import { z } from "zod";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "conversations.read");
  const id = req.nextUrl.pathname.split("/").at(-2)!;

  const conv = await prisma.conversation.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!conv) throw new TenantMismatchError();
  // R1.1 — agent scope
  if (ctx.role === "AGENT" && conv.assignedMemberId && conv.assignedMemberId !== ctx.memberId) {
    throw new TenantMismatchError();
  }

  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  await prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
  return NextResponse.json({ conversation: conv, messages });
});

const replySchema = z.object({ text: z.string().min(1).max(2000) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "conversations.reply");
  const id = req.nextUrl.pathname.split("/").at(-2)!;

  const body = replySchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "text is required (1-2000 chars)", correlationId);

  const message = await sendAgentReply(ctx, id, body.data.text);
  return NextResponse.json(message, { status: 201 });
});
