import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, parsePagination, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";

const createProjectSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(300).optional(),
  developer: z.string().max(200).optional(),
  projectType: z.string().max(100).optional(),
  deliveryDate: z.coerce.date().optional(),
  startingPrice: z.number().nonnegative().optional(),
});

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read"); // any org member can list projects
  const { skip, take, page, pageSize } = parsePagination(req);

  const [items, total] = await Promise.all([
    prisma.project.findMany({
      where: scoped(ctx),
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { _count: { select: { units: true, leads: true } } },
    }),
    prisma.project.count({ where: scoped(ctx) }),
  ]);

  return NextResponse.json({ items, page, pageSize, total });
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "projects.manage");

  const body = createProjectSchema.safeParse(await req.json());
  if (!body.success) {
    return err(422, "VALIDATION", body.error.issues.map(i => i.message).join("; "), correlationId);
  }

  const project = await prisma.project.create({
    data: { ...body.data, organizationId: ctx.organizationId },
  });

  await audit({ ctx, action: "project.create", entityType: "project", entityId: project.id, after: project, correlationId });

  return NextResponse.json(project, { status: 201 });
});
