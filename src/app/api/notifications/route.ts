import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { scoped } from "@/lib/tenant";
import { resolveChannels } from "@/lib/notification-prefs";

export const GET = withAuth(async (_req, ctx) => {
  const [rows, me] = await Promise.all([
    prisma.notification.findMany({
      where: scoped(ctx, { OR: [{ recipientMemberId: ctx.memberId }, { recipientMemberId: null }] }),
      orderBy: { createdAt: "desc" },
      // over-fetch: muted types are filtered below, and taking 50 up front would
      // let a burst of muted alerts push the visible ones off the list entirely
      take: 150,
    }),
    prisma.organizationMember.findUnique({
      where: { id: ctx.memberId },
      select: { notificationPrefs: true },
    }),
  ]);

  const items = rows.filter((n) => resolveChannels(me?.notificationPrefs, n.type).inApp).slice(0, 50);
  const unread = items.filter((n) => !n.readAt).length;
  return NextResponse.json({ items, unread });
});

export const POST = withAuth(async (_req, ctx) => {
  // marks everything read, muted types included — otherwise a muted type the
  // reader never sees would keep an invisible unread count alive forever
  await prisma.notification.updateMany({
    where: {
      organizationId: ctx.organizationId,
      OR: [{ recipientMemberId: ctx.memberId }, { recipientMemberId: null }],
      readAt: null,
    },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ ok: true });
});
