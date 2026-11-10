/** Append-only audit trail (read-only surface). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, parsePagination } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "audit.read");
  const { skip, take, page, pageSize } = parsePagination(req);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.auditLog.count({ where: { organizationId: ctx.organizationId } }),
  ]);

  const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const users = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, fullName: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.fullName]));

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.actorUserId ? (nameById.get(r.actorUserId) ?? "مستخدم محذوف") : "النظام",
      createdAt: r.createdAt,
    })),
    page,
    pageSize,
    total,
  });
});
