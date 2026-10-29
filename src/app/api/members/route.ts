/**
 * GET  /api/members — organization members with workload
 * POST /api/members — add a member. A new user gets a temporary password,
 *   returned ONCE for the admin to hand over; an existing user (another org)
 *   keeps their own password.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth";
import { ASSIGNABLE_ROLES, temporaryPassword } from "@/lib/members";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "org.members.manage");
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      user: { select: { fullName: true, email: true, phone: true, mfaEnabled: true } },
      teamMembers: { include: { team: { select: { name: true } } } },
      _count: { select: { assignedLeads: true } },
    },
  });
  return NextResponse.json({
    items: members.map((m: any) => ({
      id: m.id, role: m.role, status: m.status, joinedAt: m.joinedAt, createdAt: m.createdAt,
      fullName: m.user.fullName, email: m.user.email, phone: m.user.phone, mfaEnabled: m.user.mfaEnabled,
      teams: m.teamMembers.map((t: any) => t.team.name),
      leads: m._count.assignedLeads,
      isMe: m.id === ctx.memberId,
    })),
  });
});

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().max(30).optional(),
  role: z.enum(ASSIGNABLE_ROLES),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.members.manage");
  const body = createSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);
  const { fullName, email, phone, role } = body.data;

  let user = await prisma.user.findUnique({ where: { email } });
  let tempPassword: string | null = null;

  if (user) {
    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: ctx.organizationId, userId: user.id } },
    });
    if (existing) return err(409, "ALREADY_MEMBER", "هذا البريد عضو في الشركة بالفعل", correlationId);
  } else {
    tempPassword = temporaryPassword();
    user = await prisma.user.create({
      data: { email, fullName, phone, passwordHash: await hashPassword(tempPassword) },
    });
  }

  const member = await prisma.organizationMember.create({
    data: {
      organizationId: ctx.organizationId, userId: user.id, role, status: "ACTIVE",
      joinedAt: new Date(), invitedByEmail: undefined,
    },
  });
  await audit({ ctx, action: "member.create", entityType: "member", entityId: member.id, after: { email, role, newUser: !!tempPassword }, correlationId });

  return NextResponse.json({ id: member.id, email, role, tempPassword, existingUser: !tempPassword }, { status: 201 });
});
