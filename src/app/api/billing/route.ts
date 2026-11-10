/**
 * Everything the billing screen needs in one round trip: the catalogue, the
 * current subscription, and live usage against its limits.
 *
 * Readable by anyone who can see the org's settings — a sales manager deciding
 * whether to invite another agent needs to know how many seats are left without
 * being an admin. Changing the plan is a separate, narrower permission.
 */
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { getUsage } from "@/lib/billing";
import { METRICS, getPlan, selfServePlans } from "@/lib/plans";

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "leads.read");

  const { periodStart, entitlements, metrics } = await getUsage(ctx.organizationId);

  return NextResponse.json({
    subscription: {
      planKey: entitlements.planKey,
      planName: getPlan(entitlements.planKey)?.name ?? entitlements.planKey,
      status: entitlements.status,
      effectiveStatus: entitlements.effectiveStatus,
      trialEndsAt: entitlements.trialEndsAt,
      trialDaysLeft: entitlements.trialDaysLeft,
      currentPeriodEnd: entitlements.currentPeriodEnd,
      aiEntitled: entitlements.aiEntitled,
    },
    // the period only bounds the monthly metrics; seats and accounts are "now"
    periodStart,
    metricDefs: METRICS,
    usage: metrics,
    plans: selfServePlans(),
  });
});
