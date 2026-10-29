/** GET/PATCH /api/projects/:id — project detail with buildings and unit counts by status. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

function idFrom(url: string) {
  return new URL(url).pathname.split("/").at(-1)!;
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const id = idFrom(req.url);
  const project = await prisma.project.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { buildings: { orderBy: { name: "asc" } } },
  });
  if (!project) throw new TenantMismatchError();
  const byStatus = await prisma.unit.groupBy({
    by: ["status"],
    where: { projectId: id, organizationId: ctx.organizationId },
    _count: { _all: true },
  });
  return NextResponse.json({
    ...project,
    unitCounts: Object.fromEntries(byStatus.map((r: any) => [r.status, r._count._all])),
  });
});

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  developer: z.string().max(200).nullable().optional(),
  projectType: z.string().max(100).nullable().optional(),
  status: z.enum(["PLANNING", "UNDER_CONSTRUCTION", "READY", "DELIVERED"]).optional(),
  deliveryDate: z.coerce.date().nullable().optional(),
  startingPrice: z.number().nonnegative().nullable().optional(),
  amenities: z.array(z.string().max(100)).max(50).optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "projects.manage");
  const id = idFrom(req.url);
  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);

  const before = await prisma.project.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!before) throw new TenantMismatchError();
  const updated = await prisma.project.update({ where: { id }, data: body.data });
  await audit({ ctx, action: "project.update", entityType: "project", entityId: id, before, after: updated, correlationId });
  return NextResponse.json(updated);
});
