/** PATCH /api/members/:id — change role or suspend/reactivate, with last-admin and self-change guards. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { ASSIGNABLE_ROLES, memberChangeError, MEMBER_ERROR_MESSAGE } from "@/lib/members";

const schema = z.object({
  role: z.enum(ASSIGNABLE_ROLES).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.members.manage");
  const id = new URL(req.url).pathname.split("/").at(-1)!;
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "role or status required", correlationId);

  const target = await prisma.organizationMember.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!target) throw new TenantMismatchError();

  const activeAdminCount = await prisma.organizationMember.count({
    where: { organizationId: ctx.organizationId, role: "ORG_ADMIN", status: "ACTIVE" },
  });
  const code = memberChangeError({
    actorMemberId: ctx.memberId, target, nextRole: body.data.role, nextStatus: body.data.status, activeAdminCount,
  });
  if (code) return err(409, code, MEMBER_ERROR_MESSAGE[code], correlationId);

  const updated = await prisma.organizationMember.update({ where: { id }, data: body.data });
  await audit({
    ctx, action: "member.update", entityType: "member", entityId: id,
    before: { role: target.role, status: target.status }, after: { role: updated.role, status: updated.status }, correlationId,
  });
  return NextResponse.json(updated);
});
