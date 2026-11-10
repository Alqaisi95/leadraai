import { expect, type Page } from "@playwright/test";

/**
 * Wait until React has attached to the page.
 *
 * Server-rendered markup is visible and clickable before React hydrates, and a
 * click inside that window is swallowed with no error and no request — the page
 * simply sits there. On a cold dev server that window is seconds long, which is
 * how it produced failures that looked like a broken application.
 *
 * Two earlier attempts at this were wrong and are worth naming so they are not
 * tried again: `waitForLoadState("networkidle")` never settles under Turbopack,
 * whose HMR socket keeps the network busy; and clicking on a timer and retrying
 * cannot work when one attempt takes longer than the retry budget.
 *
 * React marks every DOM node it owns with `__reactFiber$…`. That property
 * appearing is the actual event being waited for, so this waits for exactly it.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector("input, button");
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
    },
    undefined,
    { timeout: 30_000 },
  );
}

/**
 * Click a control and wait for the request it is supposed to fire.
 *
 * The wait is generous on purpose: these endpoints hash a password with bcrypt
 * and make several database round trips, and sign-in alone takes three to six
 * seconds against a database in another region.
 */
export async function clickAndExpectRequest(page: Page, click: () => Promise<void>, urlFragment: string) {
  await waitForHydration(page);
  const waitFor = page.waitForResponse((r) => r.url().includes(urlFragment), { timeout: 30_000 });
  await click();
  await waitFor;
}

/** Sign in through the form. */
export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await clickAndExpectRequest(
    page,
    async () => {
      await page.getByLabel("البريد الإلكتروني").fill(email);
      await page.getByLabel("كلمة المرور").fill(password);
      await page.getByRole("button", { name: "دخول" }).click();
    },
    "/api/auth/login",
  );
}

export { expect };
