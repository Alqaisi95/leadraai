import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { applyScoringEvent } from "@/lib/scoring";
import { audit } from "@/lib/audit";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "appointments.manage.own");
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date();
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : new Date(Date.now() + 30 * 86400_000);

  const items = await prisma.appointment.findMany({
    where: scoped(ctx, { startsAt: { gte: from, lte: to } }),
    orderBy: { startsAt: "asc" },
    include: {
      lead: { select: { fullName: true, igUsername: true, phone: true } },
      project: { select: { name: true } },
      member: { select: { user: { select: { fullName: true } } } },
    },
  });
  return NextResponse.json({ items });
});

const createSchema = z.object({
  leadId: z.string(),
  projectId: z.string().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  location: z.string().max(300).optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "appointments.manage.own");
  const body = createSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "leadId and startsAt are required", correlationId);

  const lead = await prisma.lead.findFirst({ where: { id: body.data.leadId, organizationId: ctx.organizationId } });
  if (!lead) return err(404, "NOT_FOUND", "Lead not found", correlationId);

  const appt = await prisma.appointment.create({
    data: { ...body.data, memberId: ctx.memberId, organizationId: ctx.organizationId },
  });
  await applyScoringEvent(lead.id, "VISIT_REQUESTED");
  await audit({ ctx, action: "appointment.create", entityType: "appointment", entityId: appt.id, correlationId });
  return NextResponse.json(appt, { status: 201 });
});
