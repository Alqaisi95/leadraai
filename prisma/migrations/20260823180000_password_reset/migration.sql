-- Password reset tokens.
--
-- Only the SHA-256 hash of the token is stored, so a database dump cannot be
-- replayed into working reset links — the same rule already applied to session
-- tokens and team invitations.
--
-- NOTE: `prisma migrate diff` also wanted to drop the trigram/tsvector indexes
-- and the generated `content_tsv` column on knowledge_documents. Those are
-- hand-written in an earlier migration and have no representation in the Prisma
-- schema, so the diff sees them as drift. They are deliberately NOT dropped here.
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");

CREATE INDEX "password_resets_userId_createdAt_idx" ON "password_resets"("userId", "createdAt");

ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
