/**
 * Web push.
 *
 * The product was already built for a phone — `app/manifest.ts` sets it up to
 * install, with icons and shortcuts to the inbox, tasks and appointments — and
 * then had no way to reach that phone once it was closed. An agent works in the
 * field; a sales-ready lead arriving while the app is shut stayed unknown until
 * somebody happened to open it.
 *
 * Two rules here are not negotiable:
 *
 * 1. **The payload carries no customer data.** A push renders on a locked
 *    screen, in front of whoever is standing nearby. It gets a title, a short
 *    line, and an id to open — never a name, a phone number, or message text.
 * 2. **A dead subscription is deleted, not retried.** Browsers expire endpoints
 *    routinely. `410 Gone` and `404` mean this device is finished; keeping the
 *    row would mean failing against it forever.
 */
import webpush from "web-push";
import { prisma } from "./db";
import { captureError } from "./monitoring";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:support@leadra.ai";

/** Push is off — not broken — when the keys are absent. */
export const pushConfigured = Boolean(PUBLIC_KEY && PRIVATE_KEY);

if (pushConfigured) {
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY!, PRIVATE_KEY!);
}

export interface PushPayload {
  title: string;
  body: string;
  /** Path to open when tapped. */
  url: string;
  /** Collapses repeats of the same thing on the device. */
  tag?: string;
}

/**
 * Deliver to every device this member has registered.
 *
 * Never throws: a notification is a side effect of something more important,
 * and a push service being unreachable must not fail the request that caused
 * the notification.
 */
export async function pushToMember(memberId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured) return 0;

  const subs = await prisma.pushSubscription.findMany({ where: { memberId } });
  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let delivered = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        delivered++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          dead.push(s.id);
          return;
        }
        captureError(e, { route: "push.pushToMember", memberId });
      }
    }),
  );

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } });
  }
  if (delivered > 0) {
    await prisma.pushSubscription.updateMany({
      where: { memberId, id: { notIn: dead } },
      data: { lastSeenAt: new Date() },
    });
  }
  return delivered;
}

/** Where a notification of this type should take the person when tapped. */
export function notificationUrl(entityType?: string | null, entityId?: string | null): string {
  if (entityType === "conversation" && entityId) return `/inbox?c=${entityId}`;
  if (entityType === "lead" && entityId) return `/leads/${entityId}`;
  if (entityType === "task") return "/tasks";
  if (entityType === "appointment") return "/appointments";
  return "/notifications";
}
