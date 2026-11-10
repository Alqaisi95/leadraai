-- Saved replies an agent inserts with one click. Unique per title within an
-- organization so the picker cannot show two identical entries.
CREATE TABLE IF NOT EXISTS "canned_responses" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "useCount"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "canned_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "canned_responses_organizationId_title_key"
  ON "canned_responses" ("organizationId", "title");
CREATE INDEX IF NOT EXISTS "canned_responses_organizationId_useCount_idx"
  ON "canned_responses" ("organizationId", "useCount");

ALTER TABLE "canned_responses"
  ADD CONSTRAINT "canned_responses_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
