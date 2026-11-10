-- Team invitations: the token is stored hashed so a database dump cannot hand
-- out working invitations. Unique so a token maps to exactly one membership.
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "inviteTokenHash" TEXT;
ALTER TABLE "organization_members" ADD COLUMN IF NOT EXISTS "inviteExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_inviteTokenHash_key"
  ON "organization_members" ("inviteTokenHash");

-- First-response SLA was hard-coded to 15 minutes in the reports route.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "slaFirstResponseMin" INTEGER NOT NULL DEFAULT 15;
