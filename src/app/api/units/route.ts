/** GET /api/units?projectId=&status=&q=  ·  POST /api/units */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, parsePagination, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { unitInputSchema, ensureBuilding, UNIT_STATUSES } from "@/lib/inventory";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const { skip, take, page, pageSize } = parsePagination(req);
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim();

  const where = scoped(ctx, {
    ...(projectId ? { projectId } : {}),
    ...(status && (UNIT_STATUSES as readonly string[]).includes(status) ? { status } : {}),
    ...(q ? { OR: [{ unitNumber: { contains: q, mode: "insensitive" } }, { unitType: { contains: q, mode: "insensitive" } }] } : {}),
  });

  const [items, total] = await Promise.all([
    prisma.unit.findMany({
      where,
      orderBy: [{ projectId: "asc" }, { unitNumber: "asc" }],
      skip,
      take,
      include: { building: { select: { id: true, name: true } }, project: { select: { id: true, name: true } } },
    }),
    prisma.unit.count({ where }),
  ]);
  return NextResponse.json({ items, page, pageSize, total });
});

const createSchema = unitInputSchema.extend({
  projectId: z.string().min(1),
  buildingName: z.string().max(100).optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");
  const body = createSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), correlationId);

  const { projectId, buildingName, ...data } = body.data;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: ctx.organizationId } });
  if (!project) return err(404, "NOT_FOUND", "Project not found", correlationId);

  const exists = await prisma.unit.findFirst({ where: { projectId, unitNumber: data.unitNumber } });
  if (exists) return err(409, "DUPLICATE", `الوحدة ${data.unitNumber} موجودة في هذا المشروع`, correlationId);

  const buildingId = (await ensureBuilding(projectId, buildingName)) ?? data.buildingId;
  const unit = await prisma.unit.create({
    data: { ...data, buildingId, projectId, organizationId: ctx.organizationId },
  });
  await prisma.unitAvailabilityHistory.create({ data: { unitId: unit.id, status: unit.status, changedBy: ctx.userId } });
  if (data.price !== undefined) {
    await prisma.unitPriceHistory.create({ data: { unitId: unit.id, price: data.price, changedBy: ctx.userId } });
  }
  await audit({ ctx, action: "unit.create", entityType: "unit", entityId: unit.id, after: unit, correlationId });
  return NextResponse.json(unit, { status: 201 });
});
