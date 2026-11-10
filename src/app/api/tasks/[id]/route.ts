import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";

const schema = z.object({ status: z.enum(["OPEN", "DONE", "CANCELLED"]) });

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "tasks.manage.own");
  const id = req.nextUrl.pathname.split("/").at(-1)!;
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "status must be OPEN | DONE | CANCELLED", correlationId);

  const task = await prisma.task.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!task) throw new TenantMismatchError();
  if (task.assigneeMemberId !== ctx.memberId) requirePermission(ctx.role, "tasks.manage.any");

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: { status: body.data.status, completedAt: body.data.status === "DONE" ? new Date() : null },
  });
  return NextResponse.json(updated);
});
