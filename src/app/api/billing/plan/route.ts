/**
 * Change the organisation's package.
 *
 * There is no payment processor wired in yet, so this records the *entitlement*
 * change and nothing else — no charge is taken and none is implied. When a
 * processor is added it belongs in front of this route: collect payment, then
 * call this with the plan it paid for. Keeping the entitlement switch separate
 * from the money means a failed charge cannot leave an org upgraded, and a
 * manual or offline payment can still be honoured.
 *
 * A downgrade is refused while the organisation is over the smaller plan's
 * limits. Silently accepting it would leave the account in a state it cannot
 * act its way out of — every invite rejected, no explanation on the button.
 * The caller is told exactly which metrics block the move and by how much.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { getUsage } from "@/lib/billing";
import { METRICS, getPlan, selfServePlans } from "@/lib/plans";

const schema = z.object({ planKey: z.string().min(1) });

export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "org.billing.manage");

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(422, "VALIDATION", "planKey مطلوب", correlationId);

  const target = getPlan(body.data.planKey);
  if (!target || target.internal) {
    const offered = selfServePlans()
      .map((p) => p.name)
      .join("، ");
    return err(422, "UNKNOWN_PLAN", `الباقة غير متاحة للاختيار الذاتي. المتاح: ${offered}`, correlationId);
  }

  const { entitlements, metrics } = await getUsage(ctx.organizationId);
  if (entitlements.planKey === target.key) {
    return err(422, "NO_CHANGE", `أنت على باقة ${target.name} بالفعل`, correlationId);
  }

  // Refuse only where current usage genuinely exceeds the target — comparing
  // plan-to-plan would block a downgrade the org is well within.
  const blocking = METRICS.map((m) => {
    const limit = target.limits[m.key];
    const used = metrics[m.key].used;
    return limit != null && used > limit ? { ...m, used, limit } : null;
  }).filter(Boolean) as { key: string; label: string; unit: string; used: number; limit: number }[];

  if (blocking.length > 0) {
    const detail = blocking.map((b) => `${b.label}: ${b.used} من ${b.limit} ${b.unit}`).join("، ");
    return err(
      409,
      "DOWNGRADE_BLOCKED",
      `لا يمكن النزول إلى باقة ${target.name} قبل النزول تحت حدودها — ${detail}`,
      correlationId,
    );
  }

  const before = { planKey: entitlements.planKey, status: entitlements.status };

  const updated = await prisma.subscription.update({
    where: { organizationId: ctx.organizationId },
    data: {
      planKey: target.key,
      status: "ACTIVE",
      // choosing a paid package ends the trial; leaving the date behind would
      // keep the settings screen counting down a trial that no longer applies
      trialEndsAt: null,
      limits: target.limits,
      currentPeriodEnd: new Date(Date.now() + 30 * 86400_000),
    },
  });

  await audit({
    ctx,
    action: "subscription.plan_change",
    entityType: "subscription",
    entityId: updated.id,
    before,
    after: { planKey: target.key, status: "ACTIVE", limits: target.limits },
    correlationId,
  });

  return NextResponse.json({
    planKey: updated.planKey,
    planName: target.name,
    status: updated.status,
    limits: target.limits,
    currentPeriodEnd: updated.currentPeriodEnd,
    // no processor is wired in — say so rather than implying a charge was taken
    charged: false,
  });
});
