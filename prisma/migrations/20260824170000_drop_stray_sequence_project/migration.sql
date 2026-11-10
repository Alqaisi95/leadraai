-- Remove a column that should never have existed.
--
-- The follow-up-sequences migration was generated from a schema in which a
-- careless edit had attached Sequence to Project. Sequences are organization
-- scoped and have nothing to do with a project, so the column was always null
-- and always meaningless. Dropping it now, while it is guaranteed empty,
-- rather than leaving a field that invites someone to start using it.
ALTER TABLE "sequences" DROP CONSTRAINT IF EXISTS "sequences_projectId_fkey";
DROP INDEX IF EXISTS "sequences_projectId_idx";
ALTER TABLE "sequences" DROP COLUMN IF EXISTS "projectId";
