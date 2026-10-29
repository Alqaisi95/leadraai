import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, parsePagination } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "conversations.read");
  const { skip, take, page, pageSize } = parsePagination(req);
  const url = new URL(req.url);

  const status = url.searchParams.get("status");
  const search = url.searchParams.get("q");

  const where = scoped(ctx, {
    // R1.1 — agents see only their own or unassigned conversations
    ...(ctx.role === "AGENT" ? { OR: [{ assignedMemberId: ctx.memberId }, { assignedMemberId: null }] } : {}),
    ...(status ? { status } : {}),
    ...(url.searchParams.get("mine") === "1" ? { assignedMemberId: ctx.memberId } : {}),
    ...(search
      ? {
          OR: [
            { customerName: { contains: search, mode: "insensitive" } },
            { customerUsername: { contains: search, mode: "insensitive" } },
            { lead: { phone: { contains: search } } },
            { messages: { some: { body: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  });

  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      skip, take,
      include: {
        lead: { select: { id: true, fullName: true, score: true, temperature: true, purpose: true } },
        integration: { select: { displayName: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, senderType: true, createdAt: true } },
      },
    }),
    prisma.conversation.count({ where }),
  ]);

  return NextResponse.json({ items, page, pageSize, total });
});
