/**
 * R2.1 — scheduled jobs with execution log (job_runs).
 * Invoked by /api/worker/jobs (cron). Each job is idempotent per day/hour.
 */
import { prisma } from "./db";
import { createNotification } from "./notify";
import { applyScoringEvent } from "./scoring";

type JobFn = () => Promise<string>;

async function ranWithin(name: string, ms: number): Promise<boolean> {
  const last = await prisma.jobRun.findFirst({
    where: { name, status: "OK", startedAt: { gte: new Date(Date.now() - ms) } },
  });
  return !!last;
}

const HOURLY = 3600_000, DAILY = 86_400_000;

export const JOBS: Record<string, { every: number; fn: JobFn }> = {
  // خصم عدم الرد 48 ساعة — يومي
  noReply48hDecay: {
    every: DAILY,
    fn: async () => {
      const cutoff = new Date(Date.now() - 48 * 3600_000);
      const stale = await prisma.lead.findMany({
        where: { mergedIntoLeadId: null, lastInteractionAt: { lt: cutoff }, score: { gt: 0 }, temperature: { not: "COLD" } },
        take: 500,
      });
      let hit = 0;
      for (const l of stale) {
        const applied = await applyScoringEvent(l.id, "NO_REPLY_48H");
        if (applied) hit++;
      }
      return `decayed ${hit}/${stale.length}`;
    },
  },

  // متابعات متأخرة
  followUpOverdue: {
    every: HOURLY,
    fn: async () => {
      const convs = await prisma.conversation.findMany({
        where: { status: "FOLLOW_UP_PENDING", lastMessageAt: { lt: new Date(Date.now() - 24 * 3600_000) } },
        take: 200,
      });
      for (const c of convs) {
        await createNotification({
          organizationId: c.organizationId, recipientMemberId: c.assignedMemberId,
          type: "TASK_OVERDUE", title: "متابعة متأخرة", body: "محادثة بانتظار متابعة منذ أكثر من 24 ساعة",
          entityType: "conversation", entityId: c.id,
        });
      }
      return `flagged ${convs.length}`;
    },
  },

  // Tokens تنتهي خلال 7 أيام
  tokenExpiring: {
    every: DAILY,
    fn: async () => {
      const soon = new Date(Date.now() + 7 * DAILY);
      const tokens = await prisma.integrationToken.findMany({
        where: { revokedAt: null, expiresAt: { not: null, lte: soon, gt: new Date() } },
        include: { integration: true },
      });
      for (const t of tokens) {
        await createNotification({
          organizationId: t.integration.organizationId, type: "TOKEN_EXPIRING",
          title: `رمز ${t.integration.displayName ?? "التكامل"} سينتهي قريباً`,
          body: `ينتهي في ${t.expiresAt!.toISOString().slice(0, 10)} — أعد الربط من صفحة التكاملات`,
          entityType: "integration", entityId: t.integrationId,
        });
      }
      // mark truly-expired integrations
      await prisma.integration.updateMany({
        where: { status: "CONNECTED", tokens: { every: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }] } } },
        data: { status: "TOKEN_EXPIRED" },
      });
      return `warned ${tokens.length}`;
    },
  },

  // تذكير مواعيد (خلال 24 ساعة، ثم خلال ساعة)
  appointmentReminders: {
    every: HOURLY,
    fn: async () => {
      const now = Date.now();
      const upcoming = await prisma.appointment.findMany({
        where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gte: new Date(now), lte: new Date(now + 24 * 3600_000) } },
        include: { lead: { select: { fullName: true } } },
        take: 300,
      });
      let sent = 0;
      for (const a of upcoming) {
        const hoursAway = (a.startsAt.getTime() - now) / 3600_000;
        const bucket = hoursAway <= 1 ? "1h" : hoursAway <= 24 ? "24h" : null;
        if (!bucket) continue;
        const already = await prisma.notification.findFirst({
          where: { entityType: "appointment", entityId: a.id, body: { contains: `[${bucket}]` } },
        });
        if (already) continue;
        await createNotification({
          organizationId: a.organizationId, recipientMemberId: a.memberId,
          type: "APPOINTMENT_SOON", title: `موعد ${bucket === "1h" ? "خلال ساعة" : "غداً"}: ${a.lead.fullName ?? "عميل"}`,
          body: `[${bucket}] ${a.startsAt.toLocaleString("ar-IQ")} ${a.location ?? ""}`,
          entityType: "appointment", entityId: a.id,
        });
        sent++;
      }
      return `reminded ${sent}`;
    },
  },

  // مراقبة الـ Queue والـ Dead Letter
  queueHealth: {
    every: HOURLY,
    fn: async () => {
      const [depth, dead] = await Promise.all([
        prisma.webhookEvent.count({ where: { status: "QUEUED" } }),
        prisma.webhookEvent.count({ where: { status: "DEAD_LETTER", receivedAt: { gte: new Date(Date.now() - DAILY) } } }),
      ]);
      if (depth > 100 || dead > 0) {
        const orgs = await prisma.organization.findMany({ where: { status: "ACTIVE" }, select: { id: true }, take: 1 });
        // platform-level: notify first active org admins as fallback (Super Admin panel later)
        if (orgs[0]) {
          await createNotification({
            organizationId: orgs[0].id, type: "QUEUE_DEPTH_HIGH",
            title: "صحة الطابور", body: `Queue: ${depth} · Dead Letter (24h): ${dead}`,
          });
        }
      }
      return `depth=${depth} dead24h=${dead}`;
    },
  },
};

export async function runDueJobs() {
  const results: Record<string, string> = {};
  for (const [name, job] of Object.entries(JOBS)) {
    if (await ranWithin(name, job.every)) { results[name] = "skipped"; continue; }
    const run = await prisma.jobRun.create({ data: { name, status: "RUNNING" } });
    try {
      const detail = await job.fn();
      await prisma.jobRun.update({ where: { id: run.id }, data: { status: "OK", detail, finishedAt: new Date() } });
      results[name] = detail;
    } catch (e) {
      await prisma.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", detail: String(e).slice(0, 400), finishedAt: new Date() } });
      results[name] = "FAILED";
    }
  }
  return results;
}
