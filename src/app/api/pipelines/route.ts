import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const pipelines = await prisma.pipeline.findMany({
    where: scoped(ctx),
    include: {
      stages: {
        orderBy: { order: "asc" },
        include: {
          opportunities: {
            where: { archivedAt: null },
            include: { lead: { select: { id: true, fullName: true, igUsername: true, score: true, temperature: true, phone: true } } },
            orderBy: { updatedAt: "desc" },
            take: 50,
          },
        },
      },
    },
  });
  return NextResponse.json({ items: pipelines });
});
