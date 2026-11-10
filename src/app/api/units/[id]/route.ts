/**
 * Full unit editing. Availability already had its own endpoint (/status) because
 * it is the single source of truth the AI quotes from and every change is
 * recorded; this covers everything else — and records price changes the same
 * way, since a price is quoted to customers just as availability is.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";

const schema = z.object({
  unitNumber: z.string().min(1).max(50).optional(),
  floor: z.number().int().nullish(),
  unitType: z.string().max(100).nullish(),
  bedrooms: z.number().int().min(0).max(50).nullish(),
  bathrooms: z.number().int().min(0).max(50).nullish(),
  areaSqm: z.number().positive().nullish(),
  price: z.number().nonnegative().nullish(),
  notes: z.string().max(2000).nullish(),
});

function idFrom(pathname: string) {
  return pathname.split("/").at(-1)!;
}

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");
  const id = idFrom(req.nextUrl.pathname);

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return err(422, "VALIDATION", body.error.issues.map((i) => i.message).join("; "), correlationId);
  }

  const unit = await prisma.unit.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!unit) throw new TenantMismatchError();

  // the unique key is (projectId, unitNumber) — renaming onto a taken number
  // would fail at the database with an opaque error
  if (body.data.unitNumber && body.data.unitNumber !== unit.unitNumber) {
    const clash = await prisma.unit.findFirst({
      where: { projectId: unit.projectId, unitNumber: body.data.unitNumber },
    });
    if (clash) return err(409, "DUPLICATE", "رقم الوحدة مستخدم في هذا المشروع", correlationId);
  }

  const data = Object.fromEntries(Object.entries(body.data).filter(([, v]) => v !== undefined)) as any;
  const priceChanged = data.price !== undefined && Number(data.price ?? -1) !== Number(unit.price ?? -1);

  const [updated] = await prisma.$transaction([
    prisma.unit.update({ where: { id: unit.id }, data }),
    // a quoted price deserves the same audit trail as availability
    ...(priceChanged && data.price != null
      ? [
          prisma.unitPriceHistory.create({
            data: { unitId: unit.id, price: data.price, changedBy: ctx.userId },
          }),
        ]
      : []),
  ]);

  await audit({
    ctx,
    action: "unit.update",
    entityType: "unit",
    entityId: unit.id,
    before: { unitNumber: unit.unitNumber, price: unit.price },
    after: { unitNumber: updated.unitNumber, price: updated.price },
    correlationId,
  });

  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "units.manage");
  const id = idFrom(req.nextUrl.pathname);

  const unit = await prisma.unit.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { _count: { select: { leadViews: true } } },
  });
  if (!unit) throw new TenantMismatchError();

  // A sold unit is a record of a transaction, not inventory to tidy away.
  if (unit.status === "SOLD" || unit.status === "RESERVED") {
    return err(409, "NOT_DELETABLE", "لا يمكن حذف وحدة مباعة أو محجوزة — غيّر حالتها أولًا", correlationId);
  }

  await prisma.unit.delete({ where: { id: unit.id } });
  await audit({
    ctx,
    action: "unit.delete",
    entityType: "unit",
    entityId: unit.id,
    before: unit,
    correlationId,
  });
  return NextResponse.json({ ok: true });
});
