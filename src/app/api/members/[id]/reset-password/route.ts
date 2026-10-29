/**
 * POST /api/members/:id/reset-password — new temporary password, all sessions revoked.
 * Allowed only when this organization is the user's sole membership: an admin of
 * one company must never be able to take over an account that also belongs to another.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { hashPassword, revokeAllSessions } from "@/lib/auth";
import { temporaryPassword } from "@/lib/members";

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.members.manage");
  const id = new URL(req.url).pathname.split("/").at(-2)!;

  const member = await prisma.organizationMember.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!member) throw new TenantMismatchError();
  if (member.id === ctx.memberId) return err(409, "SELF_CHANGE", "غيّر كلمة مرورك من الإعدادات", correlationId);

  const memberships = await prisma.organizationMember.count({ where: { userId: member.userId } });
  if (memberships > 1) {
    return err(409, "SHARED_ACCOUNT", "هذا المستخدم عضو في شركة أخرى أيضاً — يغيّر كلمة مروره بنفسه", correlationId);
  }

  const tempPassword = temporaryPassword();
  await prisma.user.update({ where: { id: member.userId }, data: { passwordHash: await hashPassword(tempPassword) } });
  await revokeAllSessions(member.userId);
  await audit({ ctx, action: "member.reset_password", entityType: "member", entityId: id, correlationId });
  return NextResponse.json({ tempPassword });
});
