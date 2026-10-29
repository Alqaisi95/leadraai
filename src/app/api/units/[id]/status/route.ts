/**
 * PATCH /api/units/:id/status
 * Single source of truth for unit availability (requirements §4.9).
 * Every change is recorded in unit_availability_history + audit log.
 * The AI layer reads availability ONLY from units.status — never from documents.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

const schema = z.object({
  status: z.enum(["AVAILABLE", "TEMP_RESERVED", "RESERVED", "SOLD", "UNAVAILABLE", "ON_HOLD"]),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");

  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "Invalid status", correlationId);

  const unit = await prisma.unit.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!unit) throw new TenantMismatchError();

  const [updated] = await prisma.$transaction([
    prisma.unit.update({
      where: { id: unit.id },
      data: { status: body.data.status, statusUpdatedAt: new Date() },
    }),
    prisma.unitAvailabilityHistory.create({
      data: { unitId: unit.id, status: body.data.status, changedBy: ctx.userId },
    }),
  ]);

  await audit({
    ctx, action: "unit.status_change", entityType: "unit", entityId: unit.id,
    before: { status: unit.status }, after: { status: updated.status }, correlationId,
  });

  return NextResponse.json(updated);
});
