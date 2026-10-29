/**
 * Meta Graph API client — official APIs only, no scraping (requirements §4.3).
 * NOTE: permission names and endpoints must be re-verified against current
 * Meta docs during App Review — they change.
 */
import { prisma } from "./db";
import { decryptToken, encryptToken } from "./crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

export function oauthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: `${process.env.APP_URL}/api/integrations/meta/callback`,
    state,
    scope: [
      "instagram_basic",
      "instagram_manage_messages",
      "pages_manage_metadata",
      "pages_show_list",
      "business_management",
    ].join(","),
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function exchangeCode(code: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: `${process.env.APP_URL}/api/integrations/meta/callback`,
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${params}`);
  if (!res.ok) throw new Error(`Meta OAuth exchange failed: ${res.status}`);
  const data = await res.json();

  // exchange for long-lived token
  const llParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: data.access_token,
  });
  const ll = await fetch(`${GRAPH}/oauth/access_token?${llParams}`);
  const llData = await ll.json();
  return { accessToken: llData.access_token ?? data.access_token, expiresIn: llData.expires_in };
}

export async function listIgAccounts(accessToken: string) {
  const res = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${accessToken}`
  );
  if (!res.ok) throw new Error(`Meta accounts fetch failed: ${res.status}`);
  const data = await res.json();
  return (data.data ?? [])
    .filter((p: any) => p.instagram_business_account)
    .map((p: any) => ({
      pageId: p.id,
      pageName: p.name,
      igId: p.instagram_business_account.id,
      igUsername: p.instagram_business_account.username,
    }));
}

async function tokenFor(integrationId: string): Promise<string> {
  const t = await prisma.integrationToken.findFirst({
    where: { integrationId, revokedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!t) throw new Error("NO_ACTIVE_TOKEN");
  if (t.expiresAt && t.expiresAt < new Date()) throw new Error("TOKEN_EXPIRED");
  return decryptToken(t.encryptedToken);
}

/** Send an Instagram DM reply via the official Send API. */
export async function sendInstagramMessage(integrationId: string, recipientIgUserId: string, text: string) {
  const token = await tokenFor(integrationId);
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });

  const res = await fetch(`${GRAPH}/${integration.externalId}/messages?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientIgUserId }, message: { text } }),
  });

  if (res.status === 429) throw new RateLimitError();
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Meta send failed ${res.status}: ${errBody.slice(0, 300)}`);
  }
  return res.json() as Promise<{ message_id: string }>;
}

export class RateLimitError extends Error {
  retryable = true;
  constructor() { super("META_RATE_LIMIT"); }
}

export async function storeToken(integrationId: string, accessToken: string, expiresIn?: number) {
  await prisma.integrationToken.updateMany({
    where: { integrationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.integrationToken.create({
    data: {
      integrationId,
      encryptedToken: encryptToken(accessToken),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    },
  });
}
