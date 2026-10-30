import { expect, test } from "./helpers";

const PAGES = [
  { path: "/", title: "Overview" },
  { path: "/expenses", title: "Spendings" },
  { path: "/income", title: "Income" },
  { path: "/freelance", title: "Freelancer" },
  { path: "/accounts", title: "Accounts" },
  { path: "/investments", title: "Investments" },
  { path: "/debts", title: "Debts" },
  { path: "/settings", title: "Settings" },
] as const;

test.describe("every page loads without console errors", () => {
  for (const { path, title } of PAGES) {
    test(`${title} (${path})`, async ({ page, consoleErrors }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page).toHaveTitle(path === "/" ? /Overview/ : new RegExp(title));
      await page.waitForLoadState("networkidle");
      expect(consoleErrors).toEqual([]);
    });
  }
});

test.describe("dark theme on a phone", () => {
  test.use({ colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const { path, title } of PAGES) {
    test(`${title} (${path})`, async ({ page, consoleErrors }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await page.waitForLoadState("networkidle");
      // next-themes resolves "system" to the emulated dark scheme.
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      // No horizontal page scroll at 390 px.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(consoleErrors).toEqual([]);
    });
  }
});

test("navigates between pages through the sidebar", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation").first();
  for (const { title } of PAGES.slice(1)) {
    await page.getByRole("link", { name: title, exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }
  await expect(nav).toBeVisible();
});

test("the old Analytics page redirects to Spendings", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page).toHaveURL(/\/expenses/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spendings");
});

test("unknown routes show the not-found page", async ({ page }) => {
  const res = await page.goto("/definitely-not-a-page");
  expect(res?.status()).toBe(404);
});
