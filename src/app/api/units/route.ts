/** Inventory listing — units filtered by project/status/search. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status");

  const items = await prisma.unit.findMany({
    where: scoped(ctx, {
      ...(projectId ? { projectId } : {}),
      ...(status ? { status: status as any } : {}),
    }),
    orderBy: [{ projectId: "asc" }, { unitNumber: "asc" }],
    take: 500,
    include: {
      project: { select: { id: true, name: true } },
      building: { select: { name: true } },
    },
  });

  const counts = await prisma.unit.groupBy({
    by: ["status"],
    where: scoped(ctx, projectId ? { projectId } : {}),
    _count: true,
  });

  return NextResponse.json({
    items,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
  });
});

const createSchema = z.object({
  projectId: z.string(),
  unitNumber: z.string().min(1).max(50),
  floor: z.number().int().optional(),
  unitType: z.string().max(100).optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  areaSqm: z.number().positive().optional(),
  price: z.number().nonnegative().optional(),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");
  const body = createSchema.safeParse(await req.json());
  if (!body.success)
    return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);

  const project = await prisma.project.findFirst({
    where: { id: body.data.projectId, organizationId: ctx.organizationId },
  });
  if (!project) return err(404, "NOT_FOUND", "Project not found", correlationId);

  const exists = await prisma.unit.findFirst({
    where: { projectId: body.data.projectId, unitNumber: body.data.unitNumber },
  });
  if (exists) return err(409, "DUPLICATE", "رقم الوحدة مستخدم في هذا المشروع", correlationId);

  const unit = await prisma.unit.create({
    data: { ...body.data, organizationId: ctx.organizationId },
  });
  await audit({
    ctx,
    action: "unit.create",
    entityType: "unit",
    entityId: unit.id,
    after: unit,
    correlationId,
  });
  return NextResponse.json(unit, { status: 201 });
});
