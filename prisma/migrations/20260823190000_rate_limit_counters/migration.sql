-- Durable rate-limit counters for the anonymous credential endpoints.
-- One row per (key, window), incremented atomically with an upsert.
CREATE TABLE "rate_limit_counters" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limit_counters_key_windowStart_key"
  ON "rate_limit_counters"("key", "windowStart");

-- The cleanup job deletes by window, so that is what it needs to scan.
CREATE INDEX "rate_limit_counters_windowStart_idx" ON "rate_limit_counters"("windowStart");
