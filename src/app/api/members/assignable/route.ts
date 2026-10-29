/** GET /api/members/assignable — active sales staff a lead can be assigned to (for managers). */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "leads.assign");
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, status: "ACTIVE", role: { in: ["AGENT", "SALES_MANAGER", "ORG_ADMIN"] } },
    select: { id: true, role: true, user: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ items: members.map((m: any) => ({ id: m.id, role: m.role, fullName: m.user.fullName })) });
});
