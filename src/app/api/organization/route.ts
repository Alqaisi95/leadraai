/** GET/PATCH /api/organization — the current organization's profile. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { getUsage } from "@/lib/billing";

export const GET = withAuth(async (_req, ctx) => {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { id: true, name: true, country: true, timezone: true, language: true, status: true, createdAt: true },
  });
  const usage = await getUsage(ctx.organizationId).catch(() => null);
  return NextResponse.json({ ...org, usage, myRole: ctx.role });
});

const schema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  country: z.string().max(60).nullable().optional(),
  timezone: z.string().max(60).refine((tz) => {
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
  }, "invalid timezone").optional(),
  language: z.enum(["AR", "EN"]).optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.settings.manage");
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const updated = await prisma.organization.update({ where: { id: ctx.organizationId }, data: body.data });
  await audit({ ctx, action: "org.update", entityType: "organization", entityId: ctx.organizationId, before, after: updated, correlationId });
  return NextResponse.json(updated);
});
