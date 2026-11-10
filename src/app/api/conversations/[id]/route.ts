/**
 * Conversation assignment and status control.
 *
 * assignedMemberId existed on the model but was only ever *read* for filtering —
 * nothing wrote it, so a manager could not route work to anyone. This is that
 * write path, plus the manual status moves the state machine already allowed.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission, hasPermission } from "@/lib/rbac";
import { TenantMismatchError } from "@/lib/tenant";
import { transition } from "@/lib/conversations";
import { audit } from "@/lib/audit";

const schema = z.object({
  // null clears the assignment and returns the thread to the pool
  assignedMemberId: z.string().nullable().optional(),
  status: z
    .enum([
      "AI_ACTIVE",
      "NEEDS_HUMAN",
      "ASSIGNED_TO_AGENT",
      "AGENT_ACTIVE",
      "FOLLOW_UP_PENDING",
      "CLOSED",
      "SPAM",
    ])
    .optional(),
});

export const PATCH = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "conversations.read");
  const id = req.nextUrl.pathname.split("/").at(-1)!;

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "assignedMemberId أو status مطلوب", correlationId);
  if (body.data.assignedMemberId === undefined && body.data.status === undefined) {
    return err(422, "VALIDATION", "لا تغييرات مطلوبة", correlationId);
  }

  const conv = await prisma.conversation.findFirst({
    where: {
      id,
      organizationId: ctx.organizationId,
      // an agent may only touch their own threads or unclaimed ones
      ...(ctx.role === "AGENT"
        ? { OR: [{ assignedMemberId: ctx.memberId }, { assignedMemberId: null }] }
        : {}),
    },
  });
  if (!conv) throw new TenantMismatchError();

  const changes: Record<string, unknown> = {};

  if (body.data.assignedMemberId !== undefined) {
    const target = body.data.assignedMemberId;
    // claiming for yourself is allowed to anyone who can reply;
    // handing work to someone else is a manager action
    if (target !== ctx.memberId) requirePermission(ctx.role, "conversations.reassign");

    if (target) {
      const member = await prisma.organizationMember.findFirst({
        where: { id: target, organizationId: ctx.organizationId, status: "ACTIVE" },
      });
      if (!member) return err(422, "VALIDATION", "الموظف غير موجود أو غير نشط", correlationId);
    }
    changes.assignedMemberId = target;
  }

  // assigning an unclaimed thread should also take it off the "needs a human"
  // pile, otherwise the same conversation keeps surfacing as unhandled
  const autoStatus =
    changes.assignedMemberId && conv.status === "NEEDS_HUMAN" && !body.data.status
      ? ("ASSIGNED_TO_AGENT" as const)
      : null;

  if (Object.keys(changes).length > 0) {
    await prisma.conversation.update({ where: { id: conv.id }, data: changes });
  }

  const nextStatus = body.data.status ?? autoStatus;
  if (nextStatus && nextStatus !== conv.status) {
    try {
      await transition(conv.id, nextStatus, ctx);
    } catch (e) {
      return err(
        409,
        "INVALID_TRANSITION",
        `لا يمكن نقل المحادثة من ${conv.status} إلى ${nextStatus}`,
        correlationId,
      );
    }
  }

  // tell the person they just became responsible for this thread
  if (changes.assignedMemberId && changes.assignedMemberId !== ctx.memberId) {
    await prisma.notification.create({
      data: {
        organizationId: ctx.organizationId,
        recipientMemberId: changes.assignedMemberId as string,
        type: "HUMAN_REQUESTED",
        title: "محادثة مخصصة لك",
        body: `${conv.customerName ?? conv.customerUsername ?? "عميل"} — بانتظار ردك`,
        entityType: "conversation",
        entityId: conv.id,
      },
    });
  }

  await audit({
    ctx,
    action: "conversation.assign",
    entityType: "conversation",
    entityId: conv.id,
    before: { assignedMemberId: conv.assignedMemberId, status: conv.status },
    after: {
      assignedMemberId: changes.assignedMemberId ?? conv.assignedMemberId,
      status: nextStatus ?? conv.status,
    },
    correlationId,
  });

  const updated = await prisma.conversation.findUniqueOrThrow({
    where: { id: conv.id },
    include: { assignedMember: { select: { id: true, user: { select: { fullName: true } } } } },
  });
  return NextResponse.json(updated);
});
