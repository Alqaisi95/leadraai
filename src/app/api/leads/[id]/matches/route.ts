/** R5.2 — top unit matches for a lead, with explainable reasons. */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { TenantMismatchError } from "@/lib/tenant";
import { matchUnitsForLead } from "@/lib/matching";

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "leads.read");
  const id = req.nextUrl.pathname.split("/").at(-2)!;
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: ctx.organizationId, ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}) },
  });
  if (!lead) throw new TenantMismatchError();
  const matches = await matchUnitsForLead(id, 5);
  return NextResponse.json({ items: matches });
});
