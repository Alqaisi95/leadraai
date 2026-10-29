import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (req, ctx) => {
  const items = await prisma.notification.findMany({
    where: scoped(ctx, { OR: [{ recipientMemberId: ctx.memberId }, { recipientMemberId: null }] }),
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = items.filter(n => !n.readAt).length;
  return NextResponse.json({ items, unread });
});

export const POST = withAuth(async (_req, ctx) => {
  await prisma.notification.updateMany({
    where: { organizationId: ctx.organizationId, OR: [{ recipientMemberId: ctx.memberId }, { recipientMemberId: null }], readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});
