/**
 * A member's own notification preferences.
 *
 * Deliberately self-scoped: there is no memberId parameter, so no role can edit
 * what someone else receives. Silencing a colleague's alerts is not an admin
 * power this product should hand out.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { NOTIFICATION_TYPES, PREF_GROUPS, resolveAll, sanitizePrefs } from "@/lib/notification-prefs";

export const GET = withAuth(async (_req, ctx) => {
  const me = await prisma.organizationMember.findUnique({
    where: { id: ctx.memberId },
    select: { notificationPrefs: true },
  });

  return NextResponse.json({
    types: NOTIFICATION_TYPES,
    groups: PREF_GROUPS,
    prefs: resolveAll(me?.notificationPrefs),
  });
});

export const PUT = withAuth(async (req, ctx, correlationId) => {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.prefs !== "object" || body.prefs === null) {
    return err(422, "VALIDATION", "prefs مطلوب", correlationId);
  }

  const prefs = sanitizePrefs(body.prefs);
  await prisma.organizationMember.update({
    where: { id: ctx.memberId },
    data: { notificationPrefs: prefs },
  });

  return NextResponse.json({ prefs: resolveAll(prefs) });
});
