/**
 * Scheduled report delivery.
 *
 * Two rules that are security decisions, not conveniences:
 *
 * 1. **Recipients are member ids, never arbitrary addresses.** A free-text
 *    recipient field turns "email me this report weekly" into a data
 *    exfiltration channel with a friendly UI. Every recipient is resolved to a
 *    current, active member of the same organization at send time — so removing
 *    someone from the team stops their copy, without anyone remembering to.
 *
 * 2. **The report is generated with its creator's permissions**, resolved
 *    fresh on every run. A schedule created by a manager who later becomes a
 *    viewer stops producing the team report, rather than quietly preserving
 *    access they no longer have.
 */
import { prisma } from "./db";
import { sendEmail } from "./email";
import { buildReport, toXlsx, toCsv, REPORTS } from "./reports";
import { captureError } from "./monitoring";
import type { TenantContext } from "./tenant";
import type { RoleKey } from "./rbac";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY";

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  DAILY: "يوميًا",
  WEEKLY: "أسبوعيًا",
  MONTHLY: "شهريًا",
};

/**
 * When this schedule should next run.
 *
 * Computed from "now" rather than from the previous due time on purpose: if a
 * job run is missed — a deploy, an outage — the schedule resumes on the normal
 * cadence instead of firing a burst of catch-up emails nobody wants.
 */
export function nextRunFrom(frequency: Frequency, from = new Date()): Date {
  const next = new Date(from);
  next.setHours(7, 0, 0, 0); // morning, local to the server
  if (next <= from) next.setDate(next.getDate() + 1);

  if (frequency === "WEEKLY") {
    // Sunday: the start of the working week in this market.
    while (next.getDay() !== 0) next.setDate(next.getDate() + 1);
  } else if (frequency === "MONTHLY") {
    next.setDate(1);
    if (next <= from) next.setMonth(next.getMonth() + 1);
  }
  return next;
}

function summaryLine(reportKey: string, rowCount: number): string {
  const label = REPORTS.find((r) => r.key === reportKey)?.label ?? reportKey;
  if (rowCount === 0) return `تقرير ${label}: لا بيانات في هذه الفترة.`;
  return `تقرير ${label}: ${rowCount} صفًا. التفاصيل في المرفق.`;
}

/** Deliver one schedule now. Returns how many recipients actually received it. */
export async function sendScheduledReport(scheduleId: string): Promise<number> {
  const schedule = await prisma.scheduledReport.findUnique({
    where: { id: scheduleId },
    include: { createdBy: { select: { id: true, userId: true, role: true, status: true } } },
  });
  if (!schedule) return 0;

  // Rule 2: the creator has to still be an active member.
  if (schedule.createdBy.status !== "ACTIVE") {
    throw new Error("منشئ الجدول لم يعد عضوًا نشطًا");
  }

  const ctx: TenantContext = {
    organizationId: schedule.organizationId,
    memberId: schedule.createdBy.id,
    userId: schedule.createdBy.userId,
    role: schedule.createdBy.role as RoleKey,
  };

  // Throws ForbiddenError if the creator no longer has the permission.
  const data = await buildReport(schedule.report, ctx);

  // Rule 1: resolve ids to addresses, scoped to this organization and to
  // members who are still active.
  const recipients = await prisma.organizationMember.findMany({
    where: {
      id: { in: schedule.recipientMemberIds },
      organizationId: schedule.organizationId,
      status: "ACTIVE",
    },
    select: { user: { select: { email: true } } },
  });
  if (recipients.length === 0) return 0;

  const label = REPORTS.find((r) => r.key === schedule.report)?.label ?? schedule.report;
  const body = `${summaryLine(schedule.report, data.rows.length)}\n\nأُرسل تلقائيًا من ليدرا (${FREQUENCY_LABEL[schedule.frequency as Frequency]}).`;

  // XLSX when available, CSV when it is not — a report that arrives in a
  // slightly less convenient format beats one that does not arrive.
  let attachment;
  try {
    attachment = {
      filename: `leadra-${schedule.report}.xlsx`,
      content: await toXlsx(schedule.report, data),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  } catch {
    attachment = {
      filename: `leadra-${schedule.report}.csv`,
      content: Buffer.from(toCsv(data), "utf8"),
      contentType: "text/csv; charset=utf-8",
    };
  }

  let delivered = 0;
  for (const r of recipients) {
    if (await sendEmail(r.user.email, `[Leadra] تقرير ${label}`, body, [attachment])) delivered++;
  }

  // Recipients existed and none of them got it — the mail host is unreachable
  // or misconfigured. Returning quietly here would let the screen show
  // "sent on Sunday" for a report nobody has ever received, which is worse
  // than showing an error.
  if (delivered === 0) {
    throw new Error("تعذّر إرسال البريد إلى أي مستلم — تحقق من إعدادات SMTP");
  }

  return delivered;
}

/** Run every schedule that is due. The job entry point. */
export async function runDueReports() {
  const due = await prisma.scheduledReport.findMany({
    where: { isActive: true, nextRunAt: { lte: new Date() } },
    orderBy: { nextRunAt: "asc" },
    take: 100,
  });

  let sent = 0;
  let failed = 0;

  for (const s of due) {
    try {
      sent += await sendScheduledReport(s.id);
      await prisma.scheduledReport.update({
        where: { id: s.id },
        data: {
          lastSentAt: new Date(),
          lastError: null,
          nextRunAt: nextRunFrom(s.frequency as Frequency),
        },
      });
    } catch (e) {
      failed++;
      captureError(e, { route: "scheduledReports.runDue", scheduleId: s.id });
      // Reschedule rather than retry immediately: a permission problem or a
      // dead mail host will still be there in a minute, and a tight retry loop
      // would hammer both. The error is stored so the screen can show it.
      await prisma.scheduledReport.update({
        where: { id: s.id },
        data: {
          lastError: (e instanceof Error ? e.message : "خطأ غير متوقع").slice(0, 300),
          nextRunAt: nextRunFrom(s.frequency as Frequency),
        },
      });
    }
  }

  return { due: due.length, sent, failed };
}
