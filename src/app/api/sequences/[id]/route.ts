/** A single sequence: preview, activate/pause, and delete. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { eligibleLeads } from "@/lib/sequences";

function idFrom(pathname: string) {
  return decodeURIComponent(pathname.split("/").at(-1)!);
}

async function loadScoped(id: string, organizationId: string) {
  const sequence = await prisma.sequence.findFirst({
    where: { id, organizationId },
    include: {
      steps: { orderBy: { order: "asc" } },
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });
  if (!sequence) throw new TenantMismatchError();
  return sequence;
}

export const GET = withAuth(async (req, ctx) => {
  requirePermission(ctx.role, "sequences.manage");
  const sequence = await loadScoped(idFrom(req.nextUrl.pathname), ctx.organizationId);

  // The preview and the job share `eligibleLeads`, so the count shown before
  // activation is the count that will actually be contacted — not an estimate
  // computed a second way that can drift from the real thing.
  const eligible = await eligibleLeads(sequence.id);

  return NextResponse.json({
    sequence,
    preview: {
      count: eligible.length,
      sample: eligible.slice(0, 5).map((l) => ({ id: l.id, fullName: l.fullName })),
    },
  });
});

const patchSchema = z.object({ isActive: z.boolean() });

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "sequences.manage");
  const before = await loadScoped(idFrom(req.nextUrl.pathname), ctx.organizationId);

  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "isActive مطلوب", correlationId);

  if (body.data.isActive && before.steps.length === 0) {
    return err(422, "NO_STEPS", "لا يمكن تفعيل تسلسل بلا خطوات", correlationId);
  }

  const after = await prisma.sequence.update({
    where: { id: before.id },
    data: { isActive: body.data.isActive },
  });

  await audit({
    ctx,
    action: body.data.isActive ? "sequence.activate" : "sequence.pause",
    entityType: "Sequence",
    entityId: before.id,
    before,
    after,
    correlationId,
  });
  return NextResponse.json(after);
});

export const DELETE = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "sequences.manage");
  const sequence = await loadScoped(idFrom(req.nextUrl.pathname), ctx.organizationId);

  // Enrolments cascade. Messages already sent stay in their conversations —
  // deleting the sequence must not rewrite what customers actually received.
  await prisma.sequence.delete({ where: { id: sequence.id } });

  await audit({
    ctx,
    action: "sequence.delete",
    entityType: "Sequence",
    entityId: sequence.id,
    before: sequence,
    correlationId,
  });
  return NextResponse.json({ ok: true });
});
