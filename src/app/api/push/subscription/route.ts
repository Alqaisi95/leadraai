/** Register or remove this device for push. Each member manages their own. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { pushConfigured } from "@/lib/push";

const schema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(400), auth: z.string().min(1).max(400) }),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  if (!pushConfigured) {
    return err(503, "PUSH_UNCONFIGURED", "الإشعارات الفورية غير مُعدّة على هذا الخادم", correlationId);
  }

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "بيانات الاشتراك غير صالحة", correlationId);

  // Keyed on endpoint: the same browser re-subscribing must update its row, and
  // a device handed to a different member must move with them rather than
  // keeping the old member's notifications flowing to it.
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.data.endpoint },
    create: {
      memberId: ctx.memberId,
      endpoint: body.data.endpoint,
      p256dh: body.data.keys.p256dh,
      auth: body.data.keys.auth,
      userAgent: req.headers.get("user-agent")?.slice(0, 300),
    },
    update: {
      memberId: ctx.memberId,
      p256dh: body.data.keys.p256dh,
      auth: body.data.keys.auth,
      lastSeenAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return err(422, "VALIDATION", "endpoint مطلوب", correlationId);

  // Scoped to this member: an endpoint string must not be a way to unsubscribe
  // somebody else's device.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, memberId: ctx.memberId } });
  return NextResponse.json({ ok: true });
});
