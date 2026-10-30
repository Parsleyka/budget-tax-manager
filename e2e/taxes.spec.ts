import type { Locator, Page } from "@playwright/test";
import { convertMinor, expect, fetchNbuRate, minorFromText, minorOf, minorOrNull, percentMinor, pickDate, test } from "./helpers";

/**
 * Freelancer tax calculation for selected months + recording a tax payment. Runs in order: the
 * ЄСВ mode is switched to "minimum" and back to the default "employed" in between.
 */
test.describe.configure({ mode: "serial" });

const DATE = "2026-08-14"; // Q3 2026 (Friday)
const AMOUNT_MINOR = 200_000; // 2 000,00 $
const MIN_ESV_2026 = 190_234; // 1 902,34 ₴ = 22% × 8 647

type TaxLine = "income" | "single" | "levy" | "esv" | "total";
const taxLine = (page: Page, id: TaxLine) => minorOf(page.getByTestId(`tax-${id}`));
const taxLineOrNull = (page: Page, id: TaxLine) => minorOrNull(page.getByTestId(`tax-${id}`));

async function selectMonths(page: Page, preset: "Q3" | "YTD" | "Aug") {
  if (preset === "Aug") {
    await page.getByRole("group", { name: "Month presets" }).getByRole("button", { name: "Clear" }).click();
    await page.getByRole("group", { name: /^Months of/ }).getByRole("button", { name: "Aug" }).click();
    await expect(page.getByText("1 month selected")).toBeVisible();
  } else {
    await page.getByRole("group", { name: "Month presets" }).getByRole("button", { name: preset }).click();
  }
}

/** Opens a quarter's single tax / levy / ЄСВ detail in the declarations table (idempotent). */
async function showDetails(quarter: Locator, label: string) {
  const toggle = quarter.getByRole("button", { name: `Details for ${label}` });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function setEsvMode(page: Page, label: RegExp) {
  await page.goto("/settings");
  await page.getByRole("radio", { name: label }).click();
  await page.getByRole("button", { name: "Save tax settings" }).click();
  await expect(page.getByText("Tax settings saved").first()).toBeVisible();
}

let incomeMinor = 0;

test("single tax is 5% and the levy 1% of the selected months' UAH income; no ЄСВ when employed", async ({ page }) => {
  await page.goto("/freelance");
  await selectMonths(page, "Q3");
  const before = await taxLine(page, "income");

  const rate = await fetchNbuRate("USD", DATE);
  const added = convertMinor(AMOUNT_MINOR, rate);

  await page.getByRole("button", { name: "Add freelance income" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add freelance income" });
  await dialog.getByRole("textbox", { name: "Amount received (gross)" }).fill("2000");
  await pickDate(page, dialog.getByRole("button", { name: "Date credited" }), DATE);
  await expect.poll(() => minorOrNull(dialog.getByTestId("income-uah-preview"))).toBe(added);
  await dialog.getByRole("textbox", { name: /^Client/ }).fill("E2E Tax Client");
  await dialog.getByRole("button", { name: "Add income" }).click();
  await expect(dialog).toBeHidden();

  // The selection survives the refresh after saving.
  await expect.poll(() => taxLineOrNull(page, "income")).toBe(before + added);
  incomeMinor = before + added;
  expect(await taxLine(page, "single")).toBe(percentMinor(incomeMinor, 500));
  expect(await taxLine(page, "levy")).toBe(percentMinor(incomeMinor, 100));
  // Employed (the default): no own ЄСВ, so no ЄСВ line at all.
  await expect(page.getByTestId("tax-esv")).toHaveCount(0);
  expect(await taxLine(page, "total")).toBe(percentMinor(incomeMinor, 500) + percentMinor(incomeMinor, 100));
});

test("ЄСВ is 1 902,34 ₴ per selected month in “minimum” mode", async ({ page }) => {
  await setEsvMode(page, /^Minimum contribution/);

  await page.goto("/freelance");
  await selectMonths(page, "Q3");
  await expect.poll(() => taxLineOrNull(page, "esv")).toBe(3 * MIN_ESV_2026);
  const single = await taxLine(page, "single");
  const levy = await taxLine(page, "levy");
  expect(single).toBe(percentMinor(incomeMinor, 500));
  expect(levy).toBe(percentMinor(incomeMinor, 100));
  expect(await taxLine(page, "total")).toBe(single + levy + 3 * MIN_ESV_2026);

  await selectMonths(page, "Aug");
  await expect.poll(() => taxLineOrNull(page, "esv")).toBe(MIN_ESV_2026);

  await selectMonths(page, "YTD"); // Jan–Oct 2026
  await expect.poll(() => taxLineOrNull(page, "esv")).toBe(10 * MIN_ESV_2026);

  // Back to the default for the rest of the suite.
  await setEsvMode(page, /^Employed/);
  await page.goto("/freelance");
  await selectMonths(page, "Q3");
  await expect(page.getByTestId("tax-esv")).toHaveCount(0);
});

test("recording a tax payment marks the quarter as paid", async ({ page }) => {
  await page.goto("/freelance");
  const q3 = page.getByTestId("declaration-2026-Q3");
  await expect(q3.getByTestId("quarter-status")).toContainText(/Due/);

  await q3.getByRole("button", { name: "Record payment for Q3 2026" }).click();
  const dialog = page.getByRole("dialog", { name: "Record tax payment" });
  await expect(dialog.getByRole("combobox", { name: "For the period" })).toContainText("Q3 2026");
  // Prefilled with what is outstanding: single tax and the levy. Employed → no own ЄСВ, so no ЄСВ line at all.
  await expect(dialog.getByRole("checkbox", { name: "Single tax" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "Military levy" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "ЄСВ" })).toHaveCount(0);
  expect(minorFromText(await dialog.getByRole("textbox", { name: "Single tax amount" }).inputValue())).toBe(
    percentMinor(incomeMinor, 500),
  );
  expect(minorFromText(await dialog.getByRole("textbox", { name: "Military levy amount" }).inputValue())).toBe(
    percentMinor(incomeMinor, 100),
  );
  await dialog.getByRole("button", { name: "Record payment" }).click();
  await expect(dialog).toBeHidden();

  await expect(q3.getByTestId("quarter-status")).toHaveText("Paid");
  await showDetails(q3, "Q3 2026");
  await expect(q3.getByRole("row").filter({ hasText: "Single tax" })).toContainText("Paid");

  // JOURNEY-7: the tax tile is the accrual for the selection — it also says what of it is already paid.
  await selectMonths(page, "Q3");
  await expect(page.getByText("Taxes for selection")).toBeVisible();
  await expect(page.getByText("Taxes due", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("tax-selection-paid")).toContainText("All paid for Q3 2026");

  // The payments are Taxes spendings tagged with the quarter.
  await page.goto("/expenses");
  await expect(page.getByRole("row").filter({ hasText: "Tax payment" }).first()).toBeVisible();
});

test("“Include ЄСВ” previews the minimum ЄСВ as optional — view only, nothing becomes due", async ({ page }) => {
  await page.goto("/freelance");
  const toggle = page.getByRole("switch", { name: "Include ЄСВ" });
  await expect(toggle).not.toBeChecked();
  await selectMonths(page, "Q3");
  await expect(page.getByTestId("tax-esv")).toHaveCount(0);
  const q3 = page.getByTestId("declaration-2026-Q3");
  await showDetails(q3, "Q3 2026");
  await expect(q3.getByRole("row", { name: /ЄСВ/ })).toHaveCount(0);

  await toggle.click();
  await expect(page).toHaveURL(/[?&]esv=1/);
  await expect(toggle).toBeChecked();
  // The calculation now includes the minimum ЄСВ for Q3, marked as optional (not owed).
  await expect.poll(() => taxLineOrNull(page, "esv")).toBe(3 * MIN_ESV_2026);
  await expect(page.getByTestId("tax-esv-label")).toContainText("optional");
  // Declarations: an optional ЄСВ row; the quarter itself stays "Paid"; nothing is overdue.
  await showDetails(q3, "Q3 2026");
  await expect(q3.locator('tr[data-optional="true"]')).toContainText("Optional");
  await expect(q3.getByTestId("quarter-status")).toHaveText("Paid");
  await expect(page.getByText("Overdue tax payments")).toHaveCount(0);

  // The switch survives a change of the month selection.
  await selectMonths(page, "Aug");
  await expect.poll(() => taxLineOrNull(page, "esv")).toBe(MIN_ESV_2026);
  await expect(page).toHaveURL(/[?&]esv=1/);

  // "Record payment" offers the ЄСВ line as optional: unchecked, prefilled when ticked.
  await q3.getByRole("button", { name: "Record payment for Q3 2026" }).click();
  const dialog = page.getByRole("dialog", { name: "Record tax payment" });
  const esvLine = dialog.getByRole("checkbox", { name: "ЄСВ" });
  await expect(esvLine).not.toBeChecked();
  await expect(dialog.getByText(/Optional — not owed/)).toBeVisible();
  await esvLine.click();
  expect(minorFromText(await dialog.getByRole("textbox", { name: "ЄСВ amount" }).inputValue())).toBe(3 * MIN_ESV_2026);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // Off again: back to no ЄСВ at all.
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(page).not.toHaveURL(/[?&]esv=1/);
  await expect(page.getByTestId("tax-esv")).toHaveCount(0);
  await showDetails(q3, "Q3 2026");
  await expect(q3.getByRole("row", { name: /ЄСВ/ })).toHaveCount(0);
});
