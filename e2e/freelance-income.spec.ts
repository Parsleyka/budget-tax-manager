import { convertMinor, expect, fetchNbuRate, formatRate, minorOrNull, moneyPattern, pickDate, test } from "./helpers";

const DATE = "2026-10-09"; // a past business day (Friday)
const AMOUNT_MINOR = 123_456; // 1 234,56 $
const CLIENT = "E2E Client Inc.";

test("USD freelance income on a past date uses that day's NBU rate everywhere", async ({ page }) => {
  const rate = await fetchNbuRate("USD", DATE);
  const expectedUah = convertMinor(AMOUNT_MINOR, rate);

  await page.goto("/income");
  // "Add salary" is the primary action; freelance income is in the "…" menu.
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Add freelance income" }).click();
  const dialog = page.getByRole("dialog", { name: "Add freelance income" });
  await expect(dialog.getByRole("radio", { name: "USD" })).toBeChecked();
  await dialog.getByRole("textbox", { name: "Amount received (gross)" }).fill("1 234,56");
  await pickDate(page, dialog.getByRole("button", { name: "Date credited" }), DATE);

  // Live preview: NBU rate of that date and amount × rate rounded to kopecks.
  await expect(dialog).toContainText(formatRate(rate));
  await expect.poll(() => minorOrNull(dialog.getByTestId("income-uah-preview"))).toBe(expectedUah);

  await dialog.getByRole("textbox", { name: /^Client/ }).fill(CLIENT);
  await dialog.getByRole("button", { name: "Add income" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Freelance income added").first()).toBeVisible();

  // Income page, Freelance tab (default period: this year).
  await page.goto("/income?kind=freelance");
  const incomeRow = page.getByTestId("income-table").getByRole("row").filter({ hasText: CLIENT });
  await expect(incomeRow).toContainText(formatRate(rate));
  await expect(incomeRow).toContainText(moneyPattern(AMOUNT_MINOR, "USD"));
  await expect(incomeRow).toContainText(moneyPattern(expectedUah));

  // Freelancer page: before and after exchange.
  await page.goto("/freelance");
  const freelanceRow = page.getByRole("row").filter({ hasText: CLIENT });
  await expect(freelanceRow).toContainText(formatRate(rate));
  await expect(freelanceRow).toContainText(moneyPattern(AMOUNT_MINOR, "USD"));
  await expect(freelanceRow).toContainText(moneyPattern(expectedUah));

  // The server stored the official rate, not a client value.
  const res = await page.request.get("/api/export");
  const file = (await res.json()) as { data: { incomes: { counterparty?: string; rate: number; rateSource: string; amountUah: number }[] } };
  const stored = file.data.incomes.find((i) => i.counterparty === CLIENT);
  expect(stored).toMatchObject({ rate, rateSource: "nbu", amountUah: expectedUah / 100 });
});

test("switching the currency does not mark Currency / Account / rate as invalid", async ({ page }) => {
  await page.goto("/freelance");
  await page.getByRole("button", { name: "Add freelance income" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add freelance income" });
  const invalid = dialog.locator('[aria-invalid="true"], [data-invalid="true"]');
  await expect(invalid).toHaveCount(0);

  for (const currency of ["EUR", "UAH", "USD"]) {
    await dialog.getByRole("radio", { name: currency }).click();
    await expect(dialog.getByRole("radio", { name: currency })).toBeChecked();
    await expect(invalid).toHaveCount(0);
    await expect(dialog.locator('[data-slot="income-rate-panel"]')).not.toHaveClass(/border-destructive/);
  }

  // Real errors still show — and switching the currency clears them.
  await dialog.getByRole("button", { name: "Add income" }).click();
  await expect(dialog.getByRole("textbox", { name: /^Amount received/ })).toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("radio", { name: "EUR" }).click();
  await expect(dialog.getByRole("combobox", { name: "Account" })).not.toHaveAttribute("aria-invalid", "true");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
