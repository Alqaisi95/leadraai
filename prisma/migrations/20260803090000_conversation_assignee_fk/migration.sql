-- assignedMemberId existed as a bare column with no constraint. Give it a real
-- relation so assignment can be written and joined.
--
-- ON DELETE SET NULL, never CASCADE: removing a team member must not delete the
-- customer conversations they were handling — those threads return to the pool.

-- clear any value that does not point at a live member, or the FK would fail
UPDATE "conversations" c
   SET "assignedMemberId" = NULL
 WHERE c."assignedMemberId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "organization_members" m WHERE m."id" = c."assignedMemberId");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_assignedMemberId_fkey"
  FOREIGN KEY ("assignedMemberId") REFERENCES "organization_members"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "conversations_assignedMemberId_idx"
  ON "conversations" ("assignedMemberId");
