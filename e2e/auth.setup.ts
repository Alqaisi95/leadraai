import { test as setup, expect } from "@playwright/test";
import { signIn } from "./helpers";

const EMAIL = process.env.E2E_EMAIL ?? "admin@demo.leadra.ai";
const PASSWORD = process.env.E2E_PASSWORD ?? "Leadra@2026!";

/**
 * Signs in once and persists cookies + localStorage. Every spec reuses this,
 * which keeps the suite fast and avoids tripping the login rate limiter.
 */
setup("authenticate", async ({ page }) => {
  // The signup and credential endpoints are limited durably, in the database —
  // five signups an hour from one address, by design. That is correct for
  // production and makes the suite unrepeatable, since every run registers a
  // new company. Clearing the counters is test hygiene; weakening the limit
  // would be removing the thing the tests are meant to protect.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    await prisma.rateLimitCounter.deleteMany({});
    // A previous run's deliberately-wrong logins would otherwise count toward
    // the lockout for this run.
    await prisma.loginAttempt.deleteMany({ where: { success: false } });
  } finally {
    await prisma.$disconnect();
  }

  await signIn(page, EMAIL, PASSWORD);
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /لوحة القيادة/ })).toBeVisible();
  await page.context().storageState({ path: "e2e/.auth/state.json" });
});
