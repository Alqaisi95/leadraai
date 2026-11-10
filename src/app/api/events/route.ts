/**
 * Server-Sent Events: pushes new messages + unread notification counts.
 * Polls the DB on an interval inside the stream so the browser holds one
 * connection instead of hammering the API from every open tab.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Every tick is two queries against Postgres, per open tab, forever. At 4s the
// database never got to idle at all: the first Neon project logged ~22 hours of
// active compute a day with almost no real traffic behind it, and burned its
// whole monthly allowance. 15s costs the operator nothing they can feel in an
// inbox and cuts the standing load by three quarters.
const TICK_MS = 15_000;
const MAX_TICKS = 4; // ~60s, then the client reconnects

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "conversations.read");
  const encoder = new TextEncoder();
  let since = new Date();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send("ready", { at: since.toISOString() });

      for (let i = 0; i < MAX_TICKS; i++) {
        await new Promise((r) => setTimeout(r, TICK_MS));
        if (req.signal.aborted) break;

        try {
          const now = new Date();
          const [messages, unread] = await Promise.all([
            prisma.message.findMany({
              where: scoped(ctx, { createdAt: { gt: since }, direction: "INBOUND" }),
              orderBy: { createdAt: "asc" },
              take: 25,
              select: { id: true, conversationId: true, body: true, senderType: true, createdAt: true },
            }),
            prisma.notification.count({
              where: {
                organizationId: ctx.organizationId,
                OR: [{ recipientMemberId: ctx.memberId }, { recipientMemberId: null }],
                readAt: null,
              },
            }),
          ]);
          since = now;

          if (messages.length > 0) send("messages", { items: messages });
          send("unread", { count: unread });
        } catch {
          break;
        }
      }

      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
