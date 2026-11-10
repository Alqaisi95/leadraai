/** Internal notes on a lead — never shown to the customer, never fed to the AI. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";

const schema = z.object({ body: z.string().min(1).max(4000) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "leads.update");
  const leadId = req.nextUrl.pathname.split("/").at(-2)!;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(422, "VALIDATION", "نص الملاحظة مطلوب", correlationId);

  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      organizationId: ctx.organizationId,
      ...(ctx.role === "AGENT" ? { ownerMemberId: ctx.memberId } : {}),
    },
  });
  if (!lead) throw new TenantMismatchError();

  const note = await prisma.note.create({
    data: {
      organizationId: ctx.organizationId,
      leadId: lead.id,
      authorMemberId: ctx.memberId,
      body: parsed.data.body.trim(),
    },
  });

  const me = await prisma.organizationMember.findUnique({
    where: { id: ctx.memberId },
    select: { user: { select: { fullName: true } } },
  });

  return NextResponse.json({ ...note, author: me?.user.fullName ?? "—" }, { status: 201 });
});
