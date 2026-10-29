import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { exchangeCode, listIgAccounts, storeToken } from "@/lib/meta";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(`${process.env.APP_URL}/integrations?error=missing_params`);

  // R1.5 — validate dedicated state: exists, unexpired, unused
  const stateRow = await prisma.oauthState.findUnique({ where: { state } });
  if (!stateRow || stateRow.usedAt || stateRow.expiresAt < new Date()) {
    return NextResponse.redirect(`${process.env.APP_URL}/integrations?error=invalid_state`);
  }
  await prisma.oauthState.update({ where: { id: stateRow.id }, data: { usedAt: new Date() } });
  const organizationId = stateRow.organizationId;
  const meta = { userId: stateRow.userId };

  const { accessToken, expiresIn } = await exchangeCode(code);
  const accounts = await listIgAccounts(accessToken);
  if (accounts.length === 0) {
    return NextResponse.redirect(`${process.env.APP_URL}/integrations?error=no_ig_business_account`);
  }

  for (const acc of accounts) {
    const integration = await prisma.integration.upsert({
      where: {
        organizationId_provider_externalId: {
          organizationId, provider: "INSTAGRAM", externalId: acc.igId,
        },
      },
      create: {
        organizationId, provider: "INSTAGRAM", externalId: acc.igId,
        displayName: `@${acc.igUsername}`, status: "CONNECTED", lastSyncAt: new Date(),
      },
      update: { status: "CONNECTED", displayName: `@${acc.igUsername}`, lastSyncAt: new Date(), errorCount: 0 },
    });
    await storeToken(integration.id, accessToken, expiresIn);
    await audit({
      actorUserId: meta.userId, action: "integration.connect",
      entityType: "integration", entityId: integration.id,
      after: { provider: "INSTAGRAM", igUsername: acc.igUsername },
    });
  }

  return NextResponse.redirect(`${process.env.APP_URL}/integrations?connected=1`);
}
