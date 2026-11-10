-- Per-member notification preferences.
-- Nullable on purpose: NULL means "use the application defaults", which keeps
-- every existing member receiving exactly what they received before.
ALTER TABLE "organization_members" ADD COLUMN "notificationPrefs" JSONB;
