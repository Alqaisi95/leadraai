/** POST /api/leads/:id/notes { body } */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";

const schema = z.object({ body: z.string().trim().min(1).max(5000) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "leads.update");
  const leadId = new URL(req.url).pathname.split("/").at(-2)!;
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: ctx.organizationId, ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}) },
  });
  if (!lead) throw new TenantMismatchError();
  const body = schema.safeParse(await req.json());
  if (!body.success) return err(422, "VALIDATION", "body is required", correlationId);

  const note = await prisma.note.create({
    data: { organizationId: ctx.organizationId, leadId, authorMemberId: ctx.memberId, body: body.data.body },
  });
  await prisma.lead.update({ where: { id: leadId }, data: { lastInteractionAt: new Date() } });
  return NextResponse.json(note, { status: 201 });
});
