-- Scheduled report delivery.
--
-- Additive only: one enum and one table. Rolling back is dropping both.
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByMemberId" TEXT NOT NULL,
    "report" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL DEFAULT 'WEEKLY',
    "recipientMemberIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- The job selects on both of these together.
CREATE INDEX "scheduled_reports_isActive_nextRunAt_idx" ON "scheduled_reports"("isActive", "nextRunAt");
CREATE INDEX "scheduled_reports_organizationId_idx" ON "scheduled_reports"("organizationId");

ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_createdByMemberId_fkey"
  FOREIGN KEY ("createdByMemberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
