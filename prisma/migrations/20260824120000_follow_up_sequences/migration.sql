-- Automated follow-up sequences.
--
-- Purely additive: three new tables, three new enums, and one new value on
-- NotificationType. Nothing existing is altered or dropped, so rolling back is
-- dropping the new tables.
--
-- NOTE: `prisma migrate diff` also wanted to drop the hand-written trigram and
-- tsvector indexes on knowledge_documents, which have no representation in the
-- Prisma schema and read as drift to it. Those lines are removed here on
-- purpose — dropping them would break knowledge search.

-- CreateEnum
CREATE TYPE "SequenceTrigger" AS ENUM ('NO_REPLY');

-- CreateEnum
CREATE TYPE "SequenceStepAction" AS ENUM ('SEND_MESSAGE', 'CREATE_TASK');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'STOPPED_REPLIED', 'STOPPED_MANUAL', 'STOPPED_INELIGIBLE', 'COMPLETED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SEQUENCE_STEP_FAILED';







-- CreateTable
CREATE TABLE "sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "trigger" "SequenceTrigger" NOT NULL DEFAULT 'NO_REPLY',
    "triggerHours" INTEGER NOT NULL DEFAULT 48,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_steps" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "delayHours" INTEGER NOT NULL DEFAULT 0,
    "action" "SequenceStepAction" NOT NULL DEFAULT 'SEND_MESSAGE',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequence_enrollments" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sequences_organizationId_isActive_idx" ON "sequences"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_steps_sequenceId_order_key" ON "sequence_steps"("sequenceId", "order");

-- CreateIndex
CREATE INDEX "sequence_enrollments_status_nextRunAt_idx" ON "sequence_enrollments"("status", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_enrollments_sequenceId_leadId_key" ON "sequence_enrollments"("sequenceId", "leadId");

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "sequence_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

