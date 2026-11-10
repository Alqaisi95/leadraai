/** Scheduled report delivery: list and create. */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { scoped } from "@/lib/tenant";
import { audit } from "@/lib/audit";
import { buildReport, REPORTS } from "@/lib/reports";
import { nextRunFrom, type Frequency } from "@/lib/scheduled-reports";

export const GET = withAuth(async (_req, ctx) => {
  const items = await prisma.scheduledReport.findMany({
    where: scoped(ctx),
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { user: { select: { fullName: true } } } } },
  });

  const members = await prisma.organizationMember.findMany({
    where: { organizationId: ctx.organizationId, status: "ACTIVE" },
    select: { id: true, user: { select: { fullName: true } } },
  });

  return NextResponse.json({ items, reports: REPORTS, members });
});

const schema = z.object({
  report: z.string().min(1).max(40),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  recipientMemberIds: z.array(z.string()).min(1).max(50),
});

export const POST = withAuth(async (req, ctx, correlationId) => {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success)
    return err(422, "VALIDATION", "التقرير والتكرار ومستلم واحد على الأقل مطلوبة", correlationId);

  // Building it once here is the permission check: an unknown report or one the
  // caller may not read fails now, at the moment they ask for it, rather than
  // silently every week from a job nobody is watching.
  await buildReport(body.data.report, ctx);

  // Recipients must be current members of this organization. Anything else
  // would let a schedule address arbitrary people.
  const valid = await prisma.organizationMember.findMany({
    where: { id: { in: body.data.recipientMemberIds }, organizationId: ctx.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (valid.length !== body.data.recipientMemberIds.length) {
    return err(422, "INVALID_RECIPIENT", "بعض المستلمين ليسوا أعضاء نشطين في هذه المؤسسة", correlationId);
  }

  const created = await prisma.scheduledReport.create({
    data: {
      organizationId: ctx.organizationId,
      createdByMemberId: ctx.memberId,
      report: body.data.report,
      frequency: body.data.frequency,
      recipientMemberIds: valid.map((v) => v.id),
      nextRunAt: nextRunFrom(body.data.frequency as Frequency),
    },
  });

  await audit({
    ctx,
    action: "report.schedule.create",
    entityType: "ScheduledReport",
    entityId: created.id,
    after: created,
    correlationId,
  });
  return NextResponse.json(created, { status: 201 });
});
