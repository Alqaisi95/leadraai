/** Pause, resume, or delete one schedule. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

function idFrom(pathname: string) {
  return decodeURIComponent(pathname.split("/").at(-1)!);
}

async function loadScoped(id: string, organizationId: string) {
  const schedule = await prisma.scheduledReport.findFirst({ where: { id, organizationId } });
  if (!schedule) throw new TenantMismatchError();
  return schedule;
}

const patchSchema = z.object({ isActive: z.boolean() });

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  const before = await loadScoped(idFrom(req.nextUrl.pathname), ctx.organizationId);

  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "isActive مطلوب", correlationId);

  const after = await prisma.scheduledReport.update({
    where: { id: before.id },
    data: { isActive: body.data.isActive },
  });

  await audit({
    ctx,
    action: "report.schedule.update",
    entityType: "ScheduledReport",
    entityId: before.id,
    before,
    after,
    correlationId,
  });
  return NextResponse.json(after);
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  const schedule = await loadScoped(idFrom(req.nextUrl.pathname), ctx.organizationId);
  await prisma.scheduledReport.delete({ where: { id: schedule.id } });
  await audit({
    ctx,
    action: "report.schedule.delete",
    entityType: "ScheduledReport",
    entityId: schedule.id,
    before: schedule,
    correlationId,
  });
  return NextResponse.json({ ok: true });
});
