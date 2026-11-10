import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

const schema = z.object({ status: z.enum(["SCHEDULED", "CONFIRMED", "COMPLETED", "NO_SHOW", "CANCELLED"]) });

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "appointments.manage.own");
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "invalid status", correlationId);

  const appt = await prisma.appointment.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!appt) throw new TenantMismatchError();
  if (appt.memberId !== ctx.memberId) requirePermission(ctx.role, "appointments.manage.any");

  const updated = await prisma.appointment.update({
    where: { id: appt.id },
    data: { status: body.data.status },
  });
  await audit({
    ctx,
    action: "appointment.status_change",
    entityType: "appointment",
    entityId: appt.id,
    before: { status: appt.status },
    after: { status: updated.status },
    correlationId,
  });
  return NextResponse.json(updated);
});
