import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { z } from "zod";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "integrations.manage");
  const items = await prisma.integration.findMany({
    where: scoped(ctx),
    include: {
      tokens: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { expiresAt: true } },
      _count: { select: { conversations: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    items: items.map(i => ({
      id: i.id, provider: i.provider, displayName: i.displayName, status: i.status,
      lastSyncAt: i.lastSyncAt, errorCount: i.errorCount,
      tokenExpiresAt: i.tokens[0]?.expiresAt ?? null,
      conversations: i._count.conversations,
    })),
  });
});

const disconnectSchema = z.object({ integrationId: z.string() });

/** فصل الحساب وحذف Token (§4.3) */
export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "integrations.manage");
  const body = disconnectSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: { code: "VALIDATION", correlationId } }, { status: 422 });

  const integration = await prisma.integration.findFirst({
    where: { id: body.data.integrationId, organizationId: ctx.organizationId },
  });
  if (!integration) return NextResponse.json({ error: { code: "NOT_FOUND", correlationId } }, { status: 404 });

  await prisma.$transaction([
    prisma.integrationToken.updateMany({ where: { integrationId: integration.id }, data: { revokedAt: new Date() } }),
    prisma.integration.update({ where: { id: integration.id }, data: { status: "DISCONNECTED" } }),
  ]);
  await audit({ ctx, action: "integration.disconnect", entityType: "integration", entityId: integration.id, correlationId });
  return NextResponse.json({ ok: true });
});
