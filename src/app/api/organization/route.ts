/** Organization profile and operating targets. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: {
      id: true,
      name: true,
      country: true,
      timezone: true,
      language: true,
      slaFirstResponseMin: true,
      createdAt: true,
    },
  });

  const subscription = await prisma.subscription.findFirst({
    where: { organizationId: ctx.organizationId },
    select: { planKey: true, status: true, trialEndsAt: true, limits: true },
  });

  return NextResponse.json({ organization: org, subscription });
});

const schema = z.object({
  name: z.string().min(2).max(200).optional(),
  country: z.string().max(80).nullish(),
  timezone: z.string().min(2).max(64).optional(),
  language: z.enum(["AR", "EN"]).optional(),
  slaFirstResponseMin: z.number().int().min(1).max(1440).optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.settings.manage");
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);
  }

  if (body.data.timezone) {
    // a bad timezone would silently skew every report and reminder
    try {
      new Intl.DateTimeFormat("en", { timeZone: body.data.timezone });
    } catch {
      return err(422, "VALIDATION", "المنطقة الزمنية غير صالحة", correlationId);
    }
  }

  const before = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const data = Object.fromEntries(Object.entries(body.data).filter(([, v]) => v !== undefined)) as any;

  const org = await prisma.organization.update({ where: { id: ctx.organizationId }, data });
  await audit({
    ctx,
    action: "org.settings_update",
    entityType: "organization",
    entityId: org.id,
    before: { name: before.name, timezone: before.timezone, slaFirstResponseMin: before.slaFirstResponseMin },
    after: { name: org.name, timezone: org.timezone, slaFirstResponseMin: org.slaFirstResponseMin },
    correlationId,
  });

  return NextResponse.json({ organization: org });
});
