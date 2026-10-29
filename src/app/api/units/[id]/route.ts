/** GET/PATCH /api/units/:id — edit any unit field; status and price changes are logged. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { unitInputSchema, updateUnitWithHistory, ensureBuilding } from "@/lib/inventory";

function idFrom(url: string) {
  return new URL(url).pathname.split("/").at(-1)!;
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const unit = await prisma.unit.findFirst({
    where: { id: idFrom(req.url), organizationId: ctx.organizationId },
    include: {
      building: true,
      project: { select: { id: true, name: true } },
      priceHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      availabilityHistory: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!unit) throw new TenantMismatchError();
  return NextResponse.json(unit);
});

const patchSchema = unitInputSchema.partial().extend({ buildingName: z.string().max(100).optional() });

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");
  const id = idFrom(req.url);
  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), correlationId);

  const unit = await prisma.unit.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!unit) throw new TenantMismatchError();

  const { buildingName, ...data } = body.data;
  if (data.unitNumber && data.unitNumber !== unit.unitNumber) {
    const clash = await prisma.unit.findFirst({ where: { projectId: unit.projectId, unitNumber: data.unitNumber } });
    if (clash) return err(409, "DUPLICATE", `الوحدة ${data.unitNumber} موجودة في هذا المشروع`, correlationId);
  }
  const buildingId = await ensureBuilding(unit.projectId, buildingName);
  if (buildingId) data.buildingId = buildingId;

  const { updated } = await updateUnitWithHistory(id, unit, data, ctx.userId);
  await audit({
    ctx, action: "unit.update", entityType: "unit", entityId: id,
    before: { status: unit.status, price: unit.price }, after: { status: updated.status, price: updated.price }, correlationId,
  });
  return NextResponse.json(updated);
});
