/** Follow-up sequences: list and create. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "sequences.manage");

  const items = await prisma.sequence.findMany({
    where: scoped(ctx),
    orderBy: { createdAt: "desc" },
    include: {
      steps: { orderBy: { order: "asc" } },
      _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
    },
  });
  return NextResponse.json({ items });
});

const stepSchema = z.object({
  delayHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 90),
  action: z.enum(["SEND_MESSAGE", "CREATE_TASK"]),
  body: z.string().min(2).max(2000),
});

const schema = z.object({
  name: z.string().min(2).max(120),
  // Minimum 1 hour: a "0 hour" follow-up fires the instant a lead is created,
  // which reads as a bot, not a follow-up.
  triggerHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90),
  steps: z.array(stepSchema).min(1).max(10),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "sequences.manage");

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return err(422, "VALIDATION", "الاسم ومهلة التشغيل وخطوة واحدة على الأقل مطلوبة", correlationId);
  }

  const sequence = await prisma.sequence.create({
    data: {
      organizationId: ctx.organizationId,
      name: body.data.name,
      triggerHours: body.data.triggerHours,
      // Never active on creation: activation is a separate, deliberate act,
      // after the operator has seen how many people it would contact.
      isActive: false,
      steps: {
        create: body.data.steps.map((s, i) => ({ ...s, order: i + 1 })),
      },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  await audit({
    ctx,
    action: "sequence.create",
    entityType: "Sequence",
    entityId: sequence.id,
    after: sequence,
    correlationId,
  });
  return NextResponse.json(sequence, { status: 201 });
});
