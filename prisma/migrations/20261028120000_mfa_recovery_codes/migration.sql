-- Single-use MFA recovery codes.
--
-- Before this, losing the authenticator device locked the account permanently:
-- login() demands a TOTP code after a correct password, and a password reset
-- does not help because the second factor is still required afterwards. There
-- was no disable path either.
--
-- Only hashes are stored. A database read must not yield a working second
-- factor; that is the entire purpose of having one.
CREATE TABLE "mfa_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- Makes a code single-use at the database level, not just in application code.
CREATE UNIQUE INDEX "mfa_recovery_codes_userId_codeHash_key"
    ON "mfa_recovery_codes"("userId", "codeHash");

-- The hot query: unused codes for one user, on every recovery login.
CREATE INDEX "mfa_recovery_codes_userId_usedAt_idx"
    ON "mfa_recovery_codes"("userId", "usedAt");

ALTER TABLE "mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
