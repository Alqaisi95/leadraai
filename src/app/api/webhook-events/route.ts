/**
 * Customer messages the queue gave up on.
 *
 * After five failed attempts an event is dead-lettered and the organisation is
 * notified. The notification used to say the event "needs a manual re-run" —
 * and there was no way to do one: no endpoint, no screen. The message was out
 * of everyone's reach. This is that missing way.
 *
 *   GET  — the organisation's dead-lettered events
 *   POST — { id } puts one back on the queue with fresh attempts
 *
 * The id travels in the body, and both verbs filter by the caller's
 * organisation in the query itself; an id from another tenant is a 404 like
 * any other record that is not yours.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { listDeadLetters, processBatch, requeueDeadLetter } from "@/lib/queue";
import { afterResponse } from "@/lib/background";
import { captureError } from "@/lib/monitoring";

export const maxDuration = 60;

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "integrations.manage");
  return NextResponse.json({ items: await listDeadLetters(ctx.organizationId) });
});

const retrySchema = z.object({ id: z.string().min(1) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "integrations.manage");
  const parsed = retrySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err(422, "VALIDATION", "id مطلوب", correlationId);

  const requeued = await requeueDeadLetter(ctx.organizationId, parsed.data.id);
  if (!requeued) return err(404, "NOT_FOUND", "الرسالة غير موجودة أو أُعيدت معالجتها", correlationId);

  await audit({
    ctx,
    action: "webhook_event.retry",
    entityType: "webhook_event",
    entityId: parsed.data.id,
    correlationId,
  });

  // Start on it now rather than at the next cron tick; the cron still covers
  // the case where this cannot be scheduled.
  const started = afterResponse(async () => {
    try {
      await processBatch(3);
    } catch (e) {
      captureError(e, { route: "/api/webhook-events", phase: "background_drain", correlationId });
    }
  });

  return NextResponse.json({ ok: true, started });
});
