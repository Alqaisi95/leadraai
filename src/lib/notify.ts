import { prisma } from "./db";
import { sendEmail } from "./email";
import { resolveChannels } from "./notification-prefs";
import { pushToMember, notificationUrl } from "./push";

/**
 * Record a notification and fan it out to whoever wants it by email.
 *
 * The row is always written, even for members who muted the type in-app: the
 * notification is a record of something that happened, and muting is a display
 * choice. Filtering by preference happens on read (GET /api/notifications), so
 * one member's mute never hides the event from anyone else.
 *
 * Email and push are the opposite — they leave the system and cannot be
 * un-sent, so both are decided per recipient here, before anything goes out. That means the
 * recipient lookup now runs for every type, not just the five that used to be
 * hard-coded as email-worthy: a member can opt *in* to a type that is quiet by
 * default, and we have to look to find out.
 */
export async function createNotification(params: {
  organizationId: string;
  recipientMemberId?: string | null;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  await prisma.notification.create({ data: params as any });

  const recipients = await prisma.organizationMember.findMany({
    where: params.recipientMemberId
      ? { id: params.recipientMemberId }
      : // an unaddressed notification is an org-level event — it goes to the
        // people accountable for the org, not to every agent
        {
          organizationId: params.organizationId,
          role: { in: ["ORG_ADMIN", "SALES_MANAGER"] },
          status: "ACTIVE",
        },
    select: { id: true, notificationPrefs: true, user: { select: { email: true } } },
  });

  const url = notificationUrl(params.entityType, params.entityId);

  for (const r of recipients) {
    const channels = resolveChannels(r.notificationPrefs, params.type);

    if (channels.email) {
      await sendEmail(r.user.email, `[Leadra] ${params.title}`, params.body ?? params.title);
    }

    if (channels.push) {
      // Title and one line only. This renders on a locked screen in front of
      // whoever is nearby, so it never carries a customer's name or details —
      // the link is what takes the member to those, behind their session.
      await pushToMember(r.id, {
        title: params.title,
        body: params.body ?? "",
        url,
        tag: `${params.type}:${params.entityId ?? "org"}`,
      });
    }
  }
}
