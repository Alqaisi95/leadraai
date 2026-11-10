/**
 * Live diagnosis of a Meta integration: config presence, stored Page token,
 * and whether Meta actually considers the Page subscribed to our webhooks.
 *
 * Exists because every one of these can be wrong while the integration still
 * shows "connected" — a silent empty inbox is the hardest failure to debug.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withAuth, err } from "@/lib/api";
import { requirePermission } from "@/lib/rbac";
import { scoped } from "@/lib/tenant";
import { decryptToken } from "@/lib/crypto";
import { isPageSubscribed, subscribePageToWebhooks } from "@/lib/meta";
import { captureError } from "@/lib/monitoring";

interface Check {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export const GET = withAuth(async (_req, ctx) => {
  requirePermission(ctx.role, "integrations.manage");

  const checks: Check[] = [
    {
      key: "app_id",
      label: "معرّف تطبيق Meta مضبوط",
      ok: Boolean(process.env.META_APP_ID),
    },
    {
      key: "app_secret",
      label: "سر التطبيق مضبوط (التحقق من توقيع الرسائل)",
      ok: Boolean(process.env.META_APP_SECRET),
    },
    {
      key: "verify_token",
      label: "رمز تحقق الـ Webhook مضبوط",
      ok: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
    },
    {
      key: "app_url",
      label: "رابط التطبيق مضبوط (يستخدم في OAuth والـ Webhook)",
      ok: Boolean(process.env.APP_URL),
      detail: process.env.APP_URL ?? undefined,
    },
  ];

  const integrations = await prisma.integration.findMany({
    where: scoped(ctx, { provider: "INSTAGRAM" }),
    include: { tokens: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const accounts = await Promise.all(
    integrations.map(async (i) => {
      const token = i.tokens[0];
      let subscribed: boolean | null = null;

      if (i.pageId && token) {
        try {
          subscribed = await isPageSubscribed(i.pageId, decryptToken(token.encryptedToken));
        } catch {
          subscribed = null; // could not reach Meta — distinct from "not subscribed"
        }
      }

      return {
        id: i.id,
        displayName: i.displayName,
        status: i.status,
        hasPageId: Boolean(i.pageId),
        hasToken: Boolean(token),
        subscribed,
        lastError: i.lastError,
        conversations: undefined as number | undefined,
      };
    }),
  );

  const webhookUrl = process.env.APP_URL ? `${process.env.APP_URL}/api/webhooks/meta` : null;
  const redirectUri = process.env.APP_URL ? `${process.env.APP_URL}/api/integrations/meta/callback` : null;

  return NextResponse.json({
    checks,
    accounts,
    settings: { webhookUrl, redirectUri },
    ready: checks.every((c) => c.ok),
  });
});

/** Re-run the Page webhook subscription without a full OAuth round trip. */
export const POST = withAuth(async (req, ctx, correlationId) => {
  requirePermission(ctx.role, "integrations.manage");
  const { integrationId } = (await req.json().catch(() => ({}))) as { integrationId?: string };
  if (!integrationId) return err(422, "VALIDATION", "integrationId مطلوب", correlationId);

  const integration = await prisma.integration.findFirst({
    where: { id: integrationId, organizationId: ctx.organizationId },
    include: { tokens: { where: { revokedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!integration) return err(404, "NOT_FOUND", "التكامل غير موجود", correlationId);

  if (!integration.pageId || !integration.tokens[0]) {
    return err(409, "RECONNECT_REQUIRED", "هذا الحساب مربوط بصيغة قديمة — أعد ربطه بالكامل", correlationId);
  }

  try {
    await subscribePageToWebhooks(integration.pageId, decryptToken(integration.tokens[0].encryptedToken));
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: "CONNECTED", lastError: null, errorCount: 0 },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    captureError(e, { route: "meta.verify.subscribe", organizationId: ctx.organizationId });
    return err(502, "SUBSCRIBE_FAILED", String((e as Error).message).slice(0, 200), correlationId);
  }
});
