-- When a worker claimed an event.
--
-- Without it a claim was indistinguishable from a crash. An event is moved to
-- PROCESSING when a worker picks it up, and nothing ever moved it back: if the
-- invocation was killed mid-flight — a serverless timeout during an AI call is
-- the ordinary case — the event sat in PROCESSING forever. It was never
-- retried, never dead-lettered, and raised no notification, so a customer's
-- message was dropped with nothing anywhere to say so.
--
-- The timestamp lets the queue tell "being worked on" from "abandoned" and
-- take abandoned events back.
ALTER TABLE "webhook_events" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- Anything already stuck predates the column; stamp it far enough in the past
-- that the first sweep reclaims it.
UPDATE "webhook_events" SET "claimedAt" = "receivedAt" WHERE "status" = 'PROCESSING';
