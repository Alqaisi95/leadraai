-- Instagram DMs are sent, and their webhooks subscribed, through the linked
-- Facebook Page — so the Page id is required for the integration to function.
-- lastError carries the reason a connection is degraded (e.g. the Page webhook
-- subscription was refused) so the UI can tell the operator what to fix.

ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "pageId" TEXT;
ALTER TABLE "integrations" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
