-- Web push subscriptions.
--
-- Additive only: one new table. Rolling back is dropping it; no existing row is
-- touched, and the push channel in notificationPrefs is stored inside the
-- existing partial JSON map, so members who never opt in are unaffected.
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_memberId_idx" ON "push_subscriptions"("memberId");

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
