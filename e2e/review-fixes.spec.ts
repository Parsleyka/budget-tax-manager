import type { Page } from "@playwright/test";
import { accountBalance, addSpending, chooseOption, expect, minorOrNull, moneyPattern, test } from "./helpers";

/**
 * UI regressions for the review findings (JOURNEY-*, LEDGER-1/2, REACT-*, TAX-5). Every test leaves the
 * data as the later specs expect it (ЄСВ settings back to the defaults, temporary records deleted).
 */
test.describe.configure({ mode: "serial" });

/** Minor units → what a user types ("1234,50"). */
const typed = (minor: number) => `${Math.trunc(minor / 100)},${String(Math.abs(minor) % 100).padStart(2, "0")}`;

/** Today / tomorrow in Kyiv as the app sees them. */
function kyivDate(offsetDays = 0): { iso: string; y: number; m: number; d: number } {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date(Date.now() + offsetDays * 86_400_000));
  const [y, m, d] = iso.split("-").map(Number);
  return { iso, y, m, d };
}
const longMonth = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

/** Delay every Server Action POST (header `next-action`) so "pending" states can be observed. */
async function slowServerActions(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

test("LEDGER-1 / JOURNEY-1: Update balance as of yesterday keeps today's transfer on top", async ({ page }) => {
  await page.goto("/accounts");
  const before = await accountBalance(page, "Deposits");

  await page.getByRole("button", { name: "Transfer", exact: true }).first().click();
  const transfer = page.getByRole("dialog", { name: "Transfer between accounts" });
  await chooseOption(page, transfer.getByRole("combobox", { name: "From" }), /^Main card/);
  await chooseOption(page, transfer.getByRole("combobox", { name: "To" }), /^Deposits/);
  await transfer.getByRole("textbox", { name: "Amount", exact: true }).fill("1000");
  await transfer.getByRole("button", { name: "Transfer" }).click();
  await expect(transfer).toBeHidden();
  await expect.poll(() => accountBalance(page, "Deposits")).toBe(before + 100_000);

  // Statement balance for yesterday: 50 ₴ of interest on top of what was there before today's transfer.
  await page.getByRole("button", { name: "Actions for Deposits" }).click();
  await page.getByRole("menuitem", { name: "Update balance" }).click();
  const dialog = page.getByRole("dialog", { name: "Update balance" });
  await expect(dialog.getByTestId("adjust-current-label")).toHaveText("Current balance");
  await dialog.getByRole("button", { name: "As of" }).click();
  await page.getByRole("button", { name: "Yesterday" }).click();
  await expect(dialog.getByTestId("adjust-current-label")).toContainText("Balance on");
  await expect.poll(() => minorOrNull(dialog.getByTestId("adjust-current"))).toBe(before);
  await dialog.getByRole("textbox", { name: "Actual balance" }).fill(typed(before + 5_000));
  await expect(dialog.getByTestId("adjust-delta")).toContainText(moneyPattern(5_000));
  await dialog.getByRole("button", { name: "Update balance" }).click();
  await expect(dialog).toBeHidden();

  // Was: delta measured against today's balance → today's 1 000 ₴ transfer silently wiped.
  await expect.poll(() => accountBalance(page, "Deposits")).toBe(before + 100_000 + 5_000);
});

test("LEDGER-2 / JOURNEY-2: future dates cannot be picked for a spending", async ({ page }) => {
  const today = kyivDate();
  const tomorrow = kyivDate(1);
  test.skip(tomorrow.m !== today.m, "tomorrow is in the next month (not shown in the calendar)");
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add spending" });
  await dialog.getByRole("button", { name: "Date" }).click();
  const calendar = page.locator('[data-slot="popover-content"]').filter({ has: page.getByRole("grid") }).last();
  const day = (d: number) => calendar.getByRole("button", { name: new RegExp(`${longMonth(today.y, today.m)} ${d}(st|nd|rd|th), ${today.y}`) });
  await expect(day(today.d)).toBeEnabled();
  await expect(day(tomorrow.d)).toBeDisabled();
});

test("JOURNEY-4: “58.500” is refused instead of being saved as 58,50 ₴", async ({ page }) => {
  await page.goto("/income");
  await page.getByRole("button", { name: "Add salary" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add salary" });
  await dialog.getByRole("textbox", { name: "Net amount" }).fill("58.500");
  await dialog.getByRole("button", { name: "Add salary" }).click();
  await expect(dialog.getByText(/Ambiguous amount — use a space for thousands/)).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("JOURNEY-5: a manual USD rate is not kept after switching the income to EUR", async ({ page }) => {
  await page.goto("/freelance");
  await page.getByRole("button", { name: "Add freelance income" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add freelance income" });
  await dialog.getByRole("textbox", { name: "Amount received (gross)" }).fill("1000");
  await dialog.getByRole("button", { name: "Enter manually" }).click();
  await dialog.getByRole("textbox", { name: "Exchange rate" }).fill("44,90");
  await expect(dialog.getByTestId("income-uah-preview")).toContainText(moneyPattern(4_490_000));
  await dialog.getByRole("radio", { name: "EUR" }).click();
  // Back to the NBU lookup for EUR: no manual field, and the preview is not 1 000 × 44,90.
  await expect(dialog.getByRole("textbox", { name: "Exchange rate" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Enter manually" })).toBeVisible();
  await expect(dialog.getByTestId("income-uah-preview")).not.toContainText(moneyPattern(4_490_000));
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("REACT-3: Swap with an empty “To” shows the placeholder, not a stale account", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Transfer" }).click();
  const dialog = page.getByRole("dialog", { name: "Transfer between accounts" });
  const from = dialog.getByRole("combobox", { name: "From" });
  const to = dialog.getByRole("combobox", { name: "To" });
  await chooseOption(page, from, /^FOP USD/);
  await dialog.getByRole("button", { name: "Swap accounts" }).click();
  await expect(from).toContainText("Choose an account");
  await expect(to).toContainText("FOP USD");
  // Re-picking the same account works (it did nothing while the stale value was kept).
  await chooseOption(page, from, /^FOP USD/);
  await expect(from).toContainText("FOP USD");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("REACT-9: Esc while saving does not close the dialog; the server's field error is shown in it", async ({ page }) => {
  await page.goto("/settings?tab=categories");
  await slowServerActions(page, 1_500);
  await page.getByRole("button", { name: "New category" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New category" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Groceries"); // duplicate → refused by the server
  await dialog.getByRole("button", { name: "Create category" }).click();
  await expect(dialog.getByRole("button", { name: "Create category" })).toBeDisabled(); // saving…
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5); // outside click
  await expect(dialog.getByRole("button", { name: "Close" })).toHaveCount(0); // ✕ hidden while saving
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/already exists/).first()).toBeVisible();
  await page.unroute("**/*");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("JOURNEY-6 / JOURNEY-10: a Taxes spending is linked to its quarter, and deleting it names the payment", async ({ page }) => {
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add spending" });
  await dialog.getByRole("textbox", { name: "Amount" }).fill("100");
  await chooseOption(page, dialog.getByRole("combobox", { name: "Category" }), "Taxes");
  // The hint points to the Freelancer page; link it to ЄСВ for Q1 of this year.
  await expect(dialog.getByTestId("expense-tax-link")).toContainText("Freelancer page");
  const year = kyivDate().y;
  await chooseOption(page, dialog.getByRole("combobox", { name: "ФОП tax payment" }), "ЄСВ");
  await chooseOption(page, dialog.getByRole("combobox", { name: "Quarter it pays for" }), `for Q1 ${year}`);
  await dialog.getByRole("textbox", { name: /^Note/ }).fill("E2E ЄСВ link");
  await dialog.getByRole("button", { name: "Add spending" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`/freelance?year=${year}`);
  const q1 = page.getByTestId(`declaration-${year}-Q1`);
  await q1.getByRole("button", { name: `Details for Q1 ${year}` }).click();
  await expect(q1.getByRole("row").filter({ hasText: "ЄСВ" })).toContainText(moneyPattern(10_000));

  // Deleting it from Spendings: the row's menu and the confirmation say which tax payment it is.
  await page.goto(`/expenses?period=all&q=${encodeURIComponent("E2E ЄСВ link")}`);
  await page.getByRole("button", { name: /^Actions for 100,00.*Taxes/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this spending?" });
  await expect(confirm).toContainText(`ЄСВ for Q1 ${year}`);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("button", { name: /^Actions for 100,00.*Taxes/ })).toHaveCount(0);
});

test("REACT-10: “Open Settings” for the main account goes to the General tab", async ({ page }) => {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Actions for Main card" }).click();
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  const link = page.getByRole("link", { name: "Open Settings" });
  await expect(link).toHaveAttribute("href", "/settings?tab=general");
  await link.click();
  await expect(page.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
});

test("REACT-11 / JOURNEY-9 / REACT-7: accessible names, the range calendar, and an old custom range", async ({ page }) => {
  await page.goto("/income");
  await expect(page.getByTestId("header-rates")).toHaveAccessibleName(/^NBU rates: .*USD/);
  await expect(page.getByRole("button", { name: /^Date range: / })).toBeVisible();

  // Custom range from "All time" opens at the end of the range with month/year dropdowns.
  await page.goto("/income?period=all");
  await page.getByRole("button", { name: /^Date range: / }).click();
  const today = kyivDate();
  await expect(page.getByRole("grid", { name: `${longMonth(today.y, today.m)} ${today.y}` })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Choose the Year" }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // A custom range starting before 1900 used to crash the whole page (needs data, or Spendings shows its fresh-install screen).
  await addSpending(page, { amount: "10", category: "Transport", note: "E2E old range data" });
  await page.goto(`/expenses?from=1950-01-01&to=${today.iso}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spendings");
  await expect(page.getByTestId("period-spent")).toBeVisible();
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
});

test.describe("JOURNEY-8: dialog summaries on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the UAH equivalent of a USD spending is visible at 390 px", async ({ page }) => {
    await page.goto("/expenses");
    await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add spending" });
    await chooseOption(page, dialog.getByRole("combobox", { name: "Account" }), /^FOP USD/);
    await dialog.getByRole("textbox", { name: "Amount" }).fill("12,99");
    await expect(dialog.getByTestId("dialog-footer-summary")).toBeVisible();
    await expect(dialog.getByTestId("dialog-footer-summary")).toContainText("≈");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
});

test("TAX-5: ЄСВ exempt periods (with military service) and the 2024 opt-out are saved (then reset)", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Advanced" }).click();
  await page.getByRole("switch", { name: /I did not pay ЄСВ for 2024/ }).click();
  await page.getByRole("button", { name: "Add exempt period" }).click();
  await page.getByLabel("From month").fill("2025-03");
  await page.getByLabel(/^To month/).fill("2025-05");
  await page.getByLabel(/^Reason/).fill("Military service");
  // Military service also exempts the single tax and the levy for those months.
  await page.getByRole("checkbox", { name: /^Military service/ }).click();
  await page.getByRole("button", { name: "Save tax settings" }).click();
  await expect(page.getByText("Tax settings saved").first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch", { name: /I did not pay ЄСВ for 2024/ })).toBeChecked();
  await expect(page.getByLabel("From month")).toHaveValue("2025-03");
  await expect(page.getByLabel(/^Reason/)).toHaveValue("Military service");
  await expect(page.getByRole("checkbox", { name: /^Military service/ })).toBeChecked();

  // Back to the defaults for the rest of the suite.
  await page.getByRole("switch", { name: /I did not pay ЄСВ for 2024/ }).click();
  await page.getByRole("button", { name: "Remove exempt period 1" }).click();
  await page.getByRole("button", { name: "Save tax settings" }).click();
  await expect(page.getByText("Tax settings saved").first()).toBeVisible();
  await page.reload();
  // Nothing advanced is saved any more, so the section starts collapsed again.
  await page.getByRole("button", { name: "Advanced" }).click();
  await expect(page.getByRole("switch", { name: /I did not pay ЄСВ for 2024/ })).not.toBeChecked();
  await expect(page.getByLabel("From month")).toHaveCount(0);
});
