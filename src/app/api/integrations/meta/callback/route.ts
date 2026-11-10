import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeCode, listIgAccounts, storeToken, subscribePageToWebhooks } from "@/lib/meta";
import { audit } from "@/lib/audit";
import { getUsage } from "@/lib/billing";
import { captureError } from "@/lib/monitoring";

function back(params: string) {
  return NextResponse.redirect(`${process.env.APP_URL}/integrations?${params}`);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Meta reports user-side refusals here, not as a missing code
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return back(`error=${encodeURIComponent(url.searchParams.get("error_description") ?? oauthError)}`);
  }
  if (!code || !state) return back("error=missing_params");

  // R1.5 — validate dedicated state: exists, unexpired, unused
  const stateRow = await prisma.oauthState.findUnique({ where: { state } });
  if (!stateRow || stateRow.usedAt || stateRow.expiresAt < new Date()) {
    return back("error=invalid_state");
  }
  await prisma.oauthState.update({ where: { id: stateRow.id }, data: { usedAt: new Date() } });
  const organizationId = stateRow.organizationId;

  let accounts;
  try {
    const { accessToken } = await exchangeCode(code);
    accounts = await listIgAccounts(accessToken);
  } catch (e) {
    captureError(e, { route: "/api/integrations/meta/callback", organizationId });
    return back("error=exchange_failed");
  }

  if (accounts.length === 0) return back("error=no_ig_business_account");

  const connected: string[] = [];
  const degraded: string[] = [];
  const blocked: string[] = [];

  // The plan's igAccounts limit was advertised on the settings screen and
  // enforced nowhere, so an org on a one-account plan could connect ten.
  // Reconnecting an account already on the books is not a new seat — only
  // genuinely new externalIds count against the limit.
  const { entitlements } = await getUsage(organizationId);
  const igLimit = entitlements.limits.igAccounts;
  const alreadyConnected = new Set(
    (
      await prisma.integration.findMany({
        where: { organizationId, provider: "INSTAGRAM", status: "CONNECTED" },
        select: { externalId: true },
      })
    ).map((i) => i.externalId),
  );

  for (const acc of accounts) {
    if (igLimit != null && !alreadyConnected.has(acc.igId) && alreadyConnected.size >= igLimit) {
      blocked.push(acc.igUsername);
      continue;
    }
    alreadyConnected.add(acc.igId);

    const integration = await prisma.integration.upsert({
      where: {
        organizationId_provider_externalId: { organizationId, provider: "INSTAGRAM", externalId: acc.igId },
      },
      create: {
        organizationId,
        provider: "INSTAGRAM",
        externalId: acc.igId,
        pageId: acc.pageId,
        displayName: `@${acc.igUsername}`,
        status: "CONNECTED",
        lastSyncAt: new Date(),
      },
      update: {
        pageId: acc.pageId,
        status: "CONNECTED",
        displayName: `@${acc.igUsername}`,
        lastSyncAt: new Date(),
        errorCount: 0,
        lastError: null,
      },
    });

    // The Page token — not the user token — is what every messaging call needs.
    // Page tokens derived from a long-lived user token do not expire.
    await storeToken(integration.id, acc.pageAccessToken);

    // Without this Meta delivers no webhooks at all. Treat failure as a
    // degraded connection rather than a success, so it is visible.
    try {
      await subscribePageToWebhooks(acc.pageId, acc.pageAccessToken);
      connected.push(acc.igUsername);
    } catch (e) {
      captureError(e, { route: "meta.subscribe", organizationId, pageId: acc.pageId });
      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: "ERROR",
          lastError: "لم يتم الاشتراك في webhooks — الرسائل لن تصل. أعد الربط أو تحقق من صلاحيات الصفحة.",
        },
      });
      degraded.push(acc.igUsername);
    }

    await audit({
      actorUserId: stateRow.userId,
      action: "integration.connect",
      entityType: "integration",
      entityId: integration.id,
      after: { provider: "INSTAGRAM", igUsername: acc.igUsername, pageId: acc.pageId },
    });
  }

  // every account refused by the plan and none connected — say so precisely,
  // rather than reporting a webhook failure that did not happen
  if (connected.length === 0 && blocked.length > 0) {
    return back(`error=plan_limit&blocked=${blocked.length}&limit=${igLimit}`);
  }
  if (connected.length === 0) return back("error=subscription_failed");

  const params = [`connected=${connected.length}`];
  if (degraded.length > 0) params.push(`degraded=${degraded.length}`);
  if (blocked.length > 0) params.push(`blocked=${blocked.length}`, `limit=${igLimit}`);
  return back(params.join("&"));
}
