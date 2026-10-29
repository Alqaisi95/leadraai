import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, parsePagination, err } from "@/lib/api";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "tasks.manage.own");
  const { skip, take, page, pageSize } = parsePagination(req);
  const where = scoped(ctx, hasPermission(ctx.role, "tasks.manage.any") ? {} : { assigneeMemberId: ctx.memberId });
  const [items, total] = await Promise.all([
    prisma.task.findMany({ where, orderBy: [{ status: "asc" }, { dueAt: "asc" }], skip, take, include: { lead: { select: { fullName: true, igUsername: true } } } }),
    prisma.task.count({ where }),
  ]);
  return NextResponse.json({ items, page, pageSize, total });
});

const createSchema = z.object({
  title: z.string().min(2).max(300),
  leadId: z.string().optional(),
  assigneeMemberId: z.string().optional(),
  dueAt: z.coerce.date().optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "tasks.manage.own");
  const body = createSchema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map(i => i.message).join("; "), correlationId);

  const assignee = body.data.assigneeMemberId ?? ctx.memberId;
  if (assignee !== ctx.memberId) requirePermission(ctx.role, "tasks.manage.any");

  const task = await prisma.task.create({
    data: { ...body.data, assigneeMemberId: assignee, organizationId: ctx.organizationId },
  });
  return NextResponse.json(task, { status: 201 });
});
