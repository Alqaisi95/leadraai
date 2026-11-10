-- Email verification.
--
-- The column is nullable and nothing existing is backfilled: every account that
-- predates this migration stays unverified rather than being silently treated
-- as proven. They keep working — the gate is in front of connecting Instagram
-- and inviting members, not in front of signing in.
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verifications_tokenHash_key" ON "email_verifications"("tokenHash");
CREATE INDEX "email_verifications_userId_createdAt_idx" ON "email_verifications"("userId", "createdAt");

ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
