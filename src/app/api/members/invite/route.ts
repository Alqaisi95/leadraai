/** Invite a colleague into the organization. Admin-only, seat-limited. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { AlreadyMemberError, createInvite } from "@/lib/invitations";
import { assertCanAdd } from "@/lib/billing";
import { requireVerifiedEmail } from "@/lib/email-verification";
import { sendEmail } from "@/lib/email";

const schema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(120),
  role: z.enum(["ORG_ADMIN", "SALES_MANAGER", "AGENT", "MARKETING", "VIEWER"]),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.members.manage");
  // Otherwise anyone could send Leadra invitations from an address they do
  // not control, with this organization's name on them.
  await requireVerifiedEmail(ctx.userId, "دعوة الأعضاء");

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return err(422, "VALIDATION", "البريد والاسم والدور مطلوبة", correlationId);
  }

  // one enforcement path for every metered dimension — throws PLAN_LIMIT,
  // caught centrally in withAuth
  await assertCanAdd(ctx.organizationId, "users");

  const me = await prisma.organizationMember.findUnique({
    where: { id: ctx.memberId },
    select: { user: { select: { email: true } } },
  });

  let invite;
  try {
    invite = await createInvite({
      organizationId: ctx.organizationId,
      email: body.data.email,
      fullName: body.data.fullName,
      role: body.data.role,
      invitedByEmail: me?.user.email ?? "",
    });
  } catch (e) {
    if (e instanceof AlreadyMemberError) {
      return err(409, "ALREADY_MEMBER", "هذا الشخص عضو نشط بالفعل", correlationId);
    }
    throw e;
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true },
  });

  // Email is optional infrastructure; the link is always returned so the admin
  // can share it directly when SMTP is not configured.
  const emailed = await sendEmail(
    body.data.email,
    `دعوة للانضمام إلى ${org.name} على ليدرا AI`,
    `مرحبًا ${body.data.fullName},\n\nدُعيت للانضمام إلى ${org.name} على منصة ليدرا AI.\n\nاقبل الدعوة من هنا:\n${invite.url}\n\nالرابط صالح ٧٢ ساعة.`,
  ).catch(() => false);

  await audit({
    ctx,
    action: "member.invite",
    entityType: "member",
    entityId: invite.memberId,
    after: { email: body.data.email, role: body.data.role },
    correlationId,
  });

  return NextResponse.json(
    { ok: true, url: invite.url, expiresAt: invite.expiresAt, emailed, reinvited: invite.reused },
    { status: 201 },
  );
});

/** Revoke a pending invitation. */
export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.members.manage");
  // No verification gate here on purpose: revoking is how you undo a mistake,
  // and refusing to let an unverified admin withdraw an invitation would trap
  // them with the very thing the gate exists to prevent.
  const memberId = new URL(req.url).searchParams.get("memberId");
  if (!memberId) return err(422, "VALIDATION", "memberId مطلوب", correlationId);

  const member = await prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId: ctx.organizationId, status: "INVITED" },
  });
  if (!member) return err(404, "NOT_FOUND", "لا توجد دعوة معلّقة بهذا المعرّف", correlationId);

  await prisma.organizationMember.delete({ where: { id: member.id } });
  await audit({
    ctx,
    action: "member.invite_revoke",
    entityType: "member",
    entityId: member.id,
    correlationId,
  });
  return NextResponse.json({ ok: true });
});
