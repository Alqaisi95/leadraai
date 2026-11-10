/**
 * Meta Graph API client — official APIs only, no scraping (requirements §4.3).
 *
 * Token model, which drives everything below: OAuth returns a **user** token.
 * That token can list the user's Pages, and each Page carries its own **Page
 * access token**. Instagram DMs are sent — and their webhooks subscribed —
 * through the Page, so the Page token is what we store per integration. A user
 * token will authenticate but fail every messaging call.
 *
 * NOTE: permission names and endpoints must be re-verified against current
 * Meta docs during App Review — they change.
 */
import { prisma } from "./db";
import { decryptToken, encryptToken } from "./crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

const SCOPES = [
  "instagram_basic",
  "instagram_manage_messages",
  "pages_messaging", // required to send/receive on the Messenger Platform
  "pages_manage_metadata", // required to subscribe the Page to webhooks
  "pages_show_list",
  "business_management",
];

export function oauthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: `${process.env.APP_URL}/api/integrations/meta/callback`,
    state,
    scope: SCOPES.join(","),
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

async function graphJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (body as any)?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Meta API error: ${detail}`);
  }
  return body as any;
}

export async function exchangeCode(code: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    redirect_uri: `${process.env.APP_URL}/api/integrations/meta/callback`,
    code,
  });
  const data = await graphJson(`${GRAPH}/oauth/access_token?${params}`);

  // Exchange for a long-lived user token — Page tokens derived from a
  // long-lived user token do not expire, which is what we want to store.
  const llParams = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: data.access_token,
  });
  const ll = await graphJson(`${GRAPH}/oauth/access_token?${llParams}`).catch(() => null);
  return { accessToken: ll?.access_token ?? data.access_token, expiresIn: ll?.expires_in };
}

export interface IgAccount {
  pageId: string;
  pageName: string;
  /** Page access token — the credential every messaging call needs. */
  pageAccessToken: string;
  igId: string;
  igUsername: string;
}

export async function listIgAccounts(userAccessToken: string): Promise<IgAccount[]> {
  const data = await graphJson(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${userAccessToken}`,
  );
  return (data.data ?? [])
    .filter((p: any) => p.instagram_business_account && p.access_token)
    .map((p: any) => ({
      pageId: p.id,
      pageName: p.name,
      pageAccessToken: p.access_token,
      igId: p.instagram_business_account.id,
      igUsername: p.instagram_business_account.username,
    }));
}

/**
 * Subscribe the Page to message webhooks. Without this Meta delivers nothing —
 * the app can be configured perfectly and the inbox still stays empty forever.
 */
export async function subscribePageToWebhooks(pageId: string, pageAccessToken: string) {
  const params = new URLSearchParams({
    subscribed_fields: ["messages", "messaging_postbacks", "messaging_referrals"].join(","),
    access_token: pageAccessToken,
  });
  const body = await graphJson(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (body?.success === false) throw new Error("Meta refused the webhook subscription");
  return true;
}

/** Confirm a Page is actually subscribed — used by the integrations screen. */
export async function isPageSubscribed(pageId: string, pageAccessToken: string): Promise<boolean> {
  try {
    const body = await graphJson(`${GRAPH}/${pageId}/subscribed_apps?access_token=${pageAccessToken}`);
    return Array.isArray(body?.data) && body.data.length > 0;
  } catch {
    return false;
  }
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
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });

  // Integrations connected before Page tokens were captured cannot send. Fail
  // loudly with an actionable reason rather than a generic OAuth error.
  if (!integration.pageId) {
    throw new Error("RECONNECT_REQUIRED: هذا الحساب مربوط بصيغة قديمة — أعد ربطه من شاشة التكاملات");
  }

  const token = await tokenFor(integrationId);
  const res = await fetch(`${GRAPH}/${integration.pageId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientIgUserId },
      message: { text },
      messaging_type: "RESPONSE",
      access_token: token,
    }),
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
  constructor() {
    super("META_RATE_LIMIT");
  }
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
