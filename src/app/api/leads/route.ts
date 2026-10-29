import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, parsePagination } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const { skip, take, page, pageSize } = parsePagination(req);
  const url = new URL(req.url);

  const where = scoped(ctx, {
    ...(url.searchParams.get("purpose") ? { purpose: url.searchParams.get("purpose")! } : {}),
    ...(url.searchParams.get("minScore") ? { score: { gte: Number(url.searchParams.get("minScore")) } } : {}),
    // AGENT sees only their own leads
    ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}),
  });

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { score: "desc" },
      skip,
      take,
      include: {
        interestedProject: { select: { id: true, name: true } },
        owner: { select: { id: true, user: { select: { fullName: true } } } },
        tags: { include: { tag: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return NextResponse.json({ items, page, pageSize, total });
});
