/** Global search across leads, conversations and units — powers the ⌘K palette. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ leads: [], conversations: [], units: [] });

  const like = { contains: q, mode: "insensitive" as const };

  const [leads, conversations, units] = await Promise.all([
    prisma.lead.findMany({
      where: scoped(ctx, {
        mergedIntoLeadId: null,
        ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}),
        OR: [{ fullName: like }, { igUsername: like }, { phone: { contains: q } }],
      }),
      take: 6,
      orderBy: { score: "desc" },
      select: { id: true, fullName: true, igUsername: true, phone: true, score: true, temperature: true },
    }),
    prisma.conversation.findMany({
      where: scoped(ctx, {
        ...(ctx.role === "AGENT"
          ? { OR: [{ assignedMemberId: ctx.memberId }, { assignedMemberId: null }] }
          : {}),
        AND: [
          {
            OR: [{ customerName: like }, { customerUsername: like }, { messages: { some: { body: like } } }],
          },
        ],
      }),
      take: 6,
      orderBy: { lastMessageAt: "desc" },
      select: { id: true, customerName: true, customerUsername: true, status: true },
    }),
    prisma.unit.findMany({
      where: scoped(ctx, { OR: [{ unitNumber: like }, { project: { name: like } }] }),
      take: 6,
      include: { project: { select: { name: true } } },
    }),
  ]);

  return NextResponse.json({
    leads,
    conversations,
    units: units.map((u) => ({
      id: u.id,
      unitNumber: u.unitNumber,
      project: u.project.name,
      status: u.status,
      price: u.price,
    })),
  });
});
