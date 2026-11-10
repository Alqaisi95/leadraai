/**
 * Automated follow-up.
 *
 * The platform already measured the problem: the `NO_REPLY_48H` scoring rule
 * docks points from every lead that goes quiet, every day. It just could not do
 * anything about it — chasing was manual and depended on an agent remembering.
 *
 * Three rules shape everything below, and each one exists because the failure
 * mode it prevents is worse than the feature is valuable:
 *
 * 1. **A reply ends the sequence, immediately.** Continuing to send scripted
 *    messages to somebody who is talking to you is the single fastest way to
 *    make an automated system feel like spam.
 * 2. **One automated message per lead per day, across every sequence.** Two
 *    overlapping sequences must not be able to gang up on one person. This is
 *    enforced here, not left to whoever configures them.
 * 3. **Nothing sends silently on failure.** A step that cannot be delivered
 *    raises a task and a notification, so a human finds out rather than the
 *    lead quietly falling through.
 */
import { prisma } from "./db";
import { sendInstagramMessage } from "./meta";
import { captureError } from "./monitoring";

/** Enrolments examined per job run. Bounded so one run cannot go unbounded. */
const BATCH = 200;

/**
 * Leads a sequence would enrol right now.
 *
 * Used both by the job and by the preview the UI shows before activation —
 * the same query, so the number an operator is shown is the number that will
 * actually be contacted.
 */
export async function eligibleLeads(sequenceId: string, take = BATCH) {
  const seq = await prisma.sequence.findUnique({ where: { id: sequenceId } });
  if (!seq) return [];

  const silentSince = new Date(Date.now() - seq.triggerHours * 3600_000);

  return prisma.lead.findMany({
    where: {
      organizationId: seq.organizationId,
      // A merged lead is a duplicate that no longer exists to its owner.
      mergedIntoLeadId: null,
      // Silence is the trigger. A lead with no interaction at all has never
      // been in a conversation, so there is nothing to follow up on.
      lastInteractionAt: { not: null, lt: silentSince },
      // Won or lost leads are finished; chasing them is noise at best.
      opportunities: { none: { stage: { OR: [{ isWon: true }, { isLost: true }] }, archivedAt: null } },
      // Already being chased by this sequence.
      sequenceEnrollments: { none: { sequenceId } },
    },
    select: { id: true, fullName: true, conversationId: true, ownerMemberId: true },
    take,
  });
}

/** Enrol everyone currently eligible. Returns how many were added. */
export async function enrollEligible(sequenceId: string): Promise<number> {
  const seq = await prisma.sequence.findUnique({
    where: { id: sequenceId },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
  if (!seq || !seq.isActive || seq.steps.length === 0) return 0;

  const first = seq.steps[0];
  const leads = await eligibleLeads(sequenceId);
  if (leads.length === 0) return 0;

  const { count } = await prisma.sequenceEnrollment.createMany({
    data: leads.map((l) => ({
      sequenceId,
      leadId: l.id,
      currentStepId: first.id,
      nextRunAt: new Date(Date.now() + first.delayHours * 3600_000),
    })),
    // The unique constraint is the real guard; this keeps a race from throwing.
    skipDuplicates: true,
  });
  return count;
}

/**
 * End enrolments for leads that have since replied.
 *
 * Checked before any step runs, not after — a lead who answered an hour ago
 * must not receive the message that was already queued for them.
 */
export async function stopRepliedEnrollments(): Promise<number> {
  const active = await prisma.sequenceEnrollment.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, createdAt: true, lead: { select: { conversationId: true } } },
    take: BATCH * 2,
  });
  if (active.length === 0) return 0;

  const stopped: string[] = [];
  for (const e of active) {
    if (!e.lead.conversationId) continue;
    const replied = await prisma.message.findFirst({
      where: {
        conversationId: e.lead.conversationId,
        direction: "INBOUND",
        senderType: "CUSTOMER",
        createdAt: { gt: e.createdAt },
      },
      select: { id: true },
    });
    if (replied) stopped.push(e.id);
  }

  if (stopped.length === 0) return 0;
  const { count } = await prisma.sequenceEnrollment.updateMany({
    where: { id: { in: stopped } },
    data: { status: "STOPPED_REPLIED", stoppedAt: new Date(), nextRunAt: null },
  });
  return count;
}

/**
 * Whether this lead has already been messaged automatically today.
 *
 * Rule 2. Deliberately counts across *all* sequences: the limit protects the
 * person receiving the messages, and they do not care how many sequences an
 * operator happened to build.
 */
async function alreadyContactedToday(leadId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const recent = await prisma.sequenceEnrollment.findFirst({
    where: { leadId, lastRunAt: { gte: since } },
    select: { id: true },
  });
  return recent !== null;
}

async function raiseStepFailure(params: {
  organizationId: string;
  leadId: string;
  ownerMemberId: string | null;
  leadName: string;
  reason: string;
}) {
  await prisma.notification.create({
    data: {
      organizationId: params.organizationId,
      recipientMemberId: params.ownerMemberId,
      type: "SEQUENCE_STEP_FAILED",
      title: `تعذّرت متابعة ${params.leadName}`,
      body: `${params.reason} — تابع العميل يدويًا.`,
      entityType: "lead",
      entityId: params.leadId,
    },
  });
}

/** Run every enrolment that is due. Returns what happened, for the job log. */
export async function runDueSteps() {
  const stoppedByReply = await stopRepliedEnrollments();

  const due = await prisma.sequenceEnrollment.findMany({
    where: { status: "ACTIVE", nextRunAt: { not: null, lte: new Date() } },
    include: {
      currentStep: true,
      sequence: { select: { id: true, isActive: true, organizationId: true } },
      lead: {
        select: {
          id: true,
          fullName: true,
          ownerMemberId: true,
          mergedIntoLeadId: true,
          conversation: { select: { id: true, status: true, integrationId: true, customerExternalId: true } },
        },
      },
    },
    orderBy: { nextRunAt: "asc" },
    take: BATCH,
  });

  let sent = 0;
  let tasks = 0;
  let skipped = 0;
  let failed = 0;

  for (const e of due) {
    const step = e.currentStep;

    // A sequence paused after a lead was enrolled should stop affecting them.
    if (!step || !e.sequence.isActive || e.lead.mergedIntoLeadId) {
      await prisma.sequenceEnrollment.update({
        where: { id: e.id },
        data: { status: "STOPPED_INELIGIBLE", stoppedAt: new Date(), nextRunAt: null },
      });
      skipped++;
      continue;
    }

    if (step.action === "SEND_MESSAGE" && (await alreadyContactedToday(e.leadId))) {
      // Not a failure — try again in an hour rather than dropping the step.
      await prisma.sequenceEnrollment.update({
        where: { id: e.id },
        data: { nextRunAt: new Date(Date.now() + 3600_000) },
      });
      skipped++;
      continue;
    }

    try {
      if (step.action === "SEND_MESSAGE") {
        const conv = e.lead.conversation;
        if (!conv || ["CLOSED", "SPAM"].includes(conv.status)) {
          throw new Error("لا توجد محادثة مفتوحة");
        }
        const result = await sendInstagramMessage(conv.integrationId, conv.customerExternalId, step.body);
        await prisma.message.create({
          data: {
            organizationId: e.sequence.organizationId,
            conversationId: conv.id,
            externalMessageId: result.message_id,
            direction: "OUTBOUND",
            // SYSTEM, not AGENT: nobody typed this, and the inbox should not
            // imply a colleague did.
            senderType: "SYSTEM",
            body: step.body,
            deliveredAt: new Date(),
          },
        });
        await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date() } });
        sent++;
      } else {
        await prisma.task.create({
          data: {
            organizationId: e.sequence.organizationId,
            leadId: e.leadId,
            assigneeMemberId: e.lead.ownerMemberId,
            title: step.body,
            dueAt: new Date(),
          },
        });
        tasks++;
      }
    } catch (err) {
      failed++;
      captureError(err, { route: "sequences.runDueSteps", sequenceId: e.sequenceId, leadId: e.leadId });
      await raiseStepFailure({
        organizationId: e.sequence.organizationId,
        leadId: e.leadId,
        ownerMemberId: e.lead.ownerMemberId,
        leadName: e.lead.fullName ?? "عميل بلا اسم",
        reason: err instanceof Error ? err.message : "خطأ غير متوقع",
      });
      // Rule 3: stop rather than retry forever. A human has been told.
      await prisma.sequenceEnrollment.update({
        where: { id: e.id },
        data: { status: "STOPPED_INELIGIBLE", stoppedAt: new Date(), nextRunAt: null },
      });
      continue;
    }

    const next = await prisma.sequenceStep.findFirst({
      where: { sequenceId: e.sequenceId, order: { gt: step.order } },
      orderBy: { order: "asc" },
    });

    await prisma.sequenceEnrollment.update({
      where: { id: e.id },
      data: next
        ? {
            currentStepId: next.id,
            lastRunAt: new Date(),
            nextRunAt: new Date(Date.now() + next.delayHours * 3600_000),
          }
        : { status: "COMPLETED", lastRunAt: new Date(), nextRunAt: null, stoppedAt: new Date() },
    });
  }

  return { stoppedByReply, sent, tasks, skipped, failed };
}

/** Enrol for every active sequence, then run what is due. The job entry point. */
export async function tickSequences() {
  const active = await prisma.sequence.findMany({ where: { isActive: true }, select: { id: true } });
  let enrolled = 0;
  for (const s of active) enrolled += await enrollEligible(s.id);
  const ran = await runDueSteps();
  return { enrolled, ...ran };
}
