/** Team roster + role management. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { seatLimit, seatsInUse } from "@/lib/invitations";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const rows = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ status: "asc" }, { role: "asc" }, { createdAt: "asc" }],
    include: {
      user: { select: { id: true, fullName: true, email: true, mfaEnabled: true } },
      _count: { select: { assignedLeads: true, tasks: true, appointments: true } },
    },
  });

  const [limit, used] = await Promise.all([seatLimit(ctx.organizationId), seatsInUse(ctx.organizationId)]);

  return NextResponse.json({
    // inviteTokenHash must never leave the server
    items: rows.map(({ inviteTokenHash, ...m }) => ({
      ...m,
      inviteExpired: m.status === "INVITED" && (!m.inviteExpiresAt || m.inviteExpiresAt < new Date()),
    })),
    seats: { used, limit },
  });
});

const patchSchema = z.object({
  memberId: z.string(),
  role: z.enum(["ORG_ADMIN", "SALES_MANAGER", "AGENT", "MARKETING", "VIEWER"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.members.manage");
  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "memberId and role/status required", correlationId);

  const member = await prisma.organizationMember.findFirst({
    where: { id: body.data.memberId, organizationId: ctx.organizationId },
  });
  if (!member) return err(404, "NOT_FOUND", "Member not found", correlationId);
  if (member.id === ctx.memberId)
    return err(422, "SELF_CHANGE", "لا يمكنك تغيير دورك أو حالتك بنفسك", correlationId);

  // never leave the org without an active admin
  if (member.role === "ORG_ADMIN" && (body.data.role !== "ORG_ADMIN" || body.data.status === "SUSPENDED")) {
    const admins = await prisma.organizationMember.count({
      where: { organizationId: ctx.organizationId, role: "ORG_ADMIN", status: "ACTIVE" },
    });
    if (admins <= 1) return err(422, "LAST_ADMIN", "لا يمكن إزالة آخر مدير للمؤسسة", correlationId);
  }

  const updated = await prisma.organizationMember.update({
    where: { id: member.id },
    data: {
      ...(body.data.role ? { role: body.data.role } : {}),
      ...(body.data.status ? { status: body.data.status } : {}),
    },
  });
  await audit({
    ctx,
    action: "member.update",
    entityType: "member",
    entityId: member.id,
    before: { role: member.role, status: member.status },
    after: { role: updated.role, status: updated.status },
    correlationId,
  });
  return NextResponse.json(updated);
});
