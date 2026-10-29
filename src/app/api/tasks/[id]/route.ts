/** PATCH /api/tasks/:id { status } — complete or reopen a task. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";

const schema = z.object({ status: z.enum(["OPEN", "DONE", "CANCELLED"]) });

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "tasks.manage.own");
  const id = new URL(req.url).pathname.split("/").at(-1)!;
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "status is required", correlationId);

  const task = await prisma.task.findFirst({
    where: {
      id, organizationId: ctx.organizationId,
      ...(hasPermission(ctx.role, "tasks.manage.any") ? {} : { assigneeMemberId: ctx.memberId }),
    },
  });
  if (!task) throw new TenantMismatchError();

  const updated = await prisma.task.update({
    where: { id },
    data: { status: body.data.status, completedAt: body.data.status === "DONE" ? new Date() : null },
  });
  return NextResponse.json(updated);
});
