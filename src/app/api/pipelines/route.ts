import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim();

  // board filters narrow which cards render, never which stages exist
  const leadFilter = {
    ...(p.get("temperature") ? { temperature: p.get("temperature")! as any } : {}),
    ...(p.get("projectId") ? { interestedProjectId: p.get("projectId")! } : {}),
    ...(ctx.role === "AGENT"
      ? { ownerMemberId: ctx.memberId }
      : p.get("ownerId")
        ? { ownerMemberId: p.get("ownerId") === "unassigned" ? null : p.get("ownerId")! }
        : {}),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" as const } },
            { igUsername: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  const pipelines = await prisma.pipeline.findMany({
    where: scoped(ctx),
    include: {
      stages: {
        orderBy: { order: "asc" },
        include: {
          opportunities: {
            where: { archivedAt: null, lead: leadFilter },
            include: {
              lead: {
                select: {
                  id: true,
                  fullName: true,
                  igUsername: true,
                  score: true,
                  temperature: true,
                  phone: true,
                  nextStep: true,
                  owner: { select: { id: true, user: { select: { fullName: true } } } },
                },
              },
            },
            orderBy: { updatedAt: "desc" },
            take: 60,
          },
          _count: { select: { opportunities: { where: { archivedAt: null } } } },
        },
      },
    },
  });

  return NextResponse.json({ items: pipelines });
});
