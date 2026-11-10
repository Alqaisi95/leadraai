-- Billing notifications used to borrow SLA_WARNING, which put "you are near your
-- plan limit" in the same bucket as "a customer is waiting for a reply" — and
-- let a member mute one by muting the other.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PLAN_LIMIT_WARNING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PLAN_LIMIT_REACHED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRIAL_ENDING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_EXPIRED';
