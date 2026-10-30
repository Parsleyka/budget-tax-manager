import { expect, minorOf, test } from "./helpers";

test("Overview “Show in” switch converts the totals for display only, and remembers the choice", async ({ page }) => {
  await page.goto("/");
  const active = page.getByTestId("active-balance");
  await expect(active).toHaveAttribute("data-display-currency", "UAH");
  const uahBefore = await minorOf(active);
  const toggle = page.getByTestId("display-currency");
  await expect(toggle.getByRole("radio", { name: "UAH" })).toBeChecked();

  await toggle.getByRole("radio", { name: "USD" }).click();
  await expect(active).toHaveAttribute("data-display-currency", "USD");
  await expect(active).toContainText("$");
  await expect(page.getByTestId("net-worth")).toContainText("$");
  await expect(page.getByTestId("frozen-balance")).toContainText("$");
  // The exact UAH figure and the rate are in the tooltip.
  await expect(active).toHaveAttribute("title", /₴ at \d+,\d{4} ₴ per \$/);

  // Remembered after a reload (cookie), rendered in USD straight from the server.
  await page.reload();
  await expect(page.getByTestId("active-balance")).toHaveAttribute("data-display-currency", "USD");

  // Other pages keep hryvnias; nothing stored changed.
  await page.goto("/accounts");
  const mainCard = page.locator('[data-testid="account-row"][data-account="Main card"]').getByTestId("account-balance");
  await expect(mainCard).toContainText("₴");
  await expect(page.locator("#group-active")).not.toContainText("$");

  await page.goto("/");
  await page.getByTestId("display-currency").getByRole("radio", { name: "UAH" }).click();
  await expect(page.getByTestId("active-balance")).toHaveAttribute("data-display-currency", "UAH");
  expect(await minorOf(page.getByTestId("active-balance"))).toBe(uahBefore);
});
