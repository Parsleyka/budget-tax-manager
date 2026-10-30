import { expect, test as base, type Locator, type Page } from "@playwright/test";

// ------------------------------------------------------------------ fixtures

/**
 * `test` that fails on any uncaught page error. Console errors are collected in `consoleErrors`
 * (asserted to be empty by the page-load specs).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      page.on("pageerror", (err) => pageErrors.push(err.message));
      await use(errors);
      expect(pageErrors, "uncaught errors in the page").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// ------------------------------------------------------------------ money

/** "41 230,50 ₴" / "−1 000,00 $" / "+5,00 €" → integer minor units (kopecks / cents). */
export function minorFromText(text: string): number {
  const cleaned = text
    .replace(/[\s  ]/g, "")
    .replace(/[−–]/g, "-")
    .replace(/[₴$€+]/g, "")
    .replace(",", ".");
  const value = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(value)) throw new Error(`Not a money value: "${text}"`);
  return Math.round(value * 100);
}

/** Money text of a locator in minor units. */
export async function minorOf(locator: Locator): Promise<number> {
  return minorFromText(await locator.innerText());
}

/** Like `minorOf`, but null while the element shows no money yet ("—", loading) — for `expect.poll`. */
export async function minorOrNull(locator: Locator): Promise<number | null> {
  try {
    return minorFromText(await locator.innerText({ timeout: 2_000 }));
  } catch {
    return null;
  }
}

/** amount (minor) × rate, HALF-UP to minor units — the app's convertToUah, independently. */
export function convertMinor(amountMinor: number, rate: number): number {
  const rate4 = BigInt(Math.round(rate * 10_000));
  const product = BigInt(amountMinor) * rate4;
  return Number((product + 5_000n) / 10_000n);
}

/** HALF-UP percentage of a positive minor amount in basis points (500 = 5%). */
export function percentMinor(amountMinor: number, bp: number): number {
  return Number((BigInt(amountMinor) * BigInt(bp) + 5_000n) / 10_000n);
}

/** Minor units → the app's display string (uk-UA, narrow symbol), with plain spaces. */
export function formatMinor(minor: number, currency: "UAH" | "USD" | "EUR" = "UAH"): string {
  return new Intl.NumberFormat("uk-UA", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
    .format(minor / 100)
    .replace(/[  ]/g, " ");
}

/** Regex for a displayed money string, tolerant of the NBSP / narrow NBSP the app renders. */
export function moneyPattern(minor: number, currency: "UAH" | "USD" | "EUR" = "UAH"): RegExp {
  const escaped = formatMinor(minor, currency).replace(/[.*+?^${}()|[\]\\$]/g, "\\$&");
  return new RegExp(escaped.replace(/ /g, "[\\s\\u00a0\\u202f]"));
}

/** NBU rate as the app shows it ("44,8526"). */
export function formatRate(rate: number): string {
  return rate.toFixed(4).replace(".", ",");
}

// ------------------------------------------------------------------ NBU

/** Official NBU rate (UAH per unit) for a date, straight from bank.gov.ua. */
export async function fetchNbuRate(currency: "USD" | "EUR", isoDate: string): Promise<number> {
  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${currency}&date=${isoDate.replaceAll("-", "")}&json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const rows = (await res.json()) as { rate: number; exchangedate: string }[];
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`No NBU rate for ${currency} on ${isoDate}`);
  return rows[0].rate;
}

// ------------------------------------------------------------------ widgets

/** Pick an ISO date in the app's DatePicker (popover calendar with month/year dropdowns). */
export async function pickDate(page: Page, trigger: Locator, isoDate: string): Promise<void> {
  const [y, m, d] = isoDate.split("-").map(Number);
  await trigger.click();
  const calendar = page.locator('[data-slot="popover-content"]').filter({ has: page.getByRole("grid") }).last();
  await expect(calendar).toBeVisible();
  await calendar.getByRole("combobox", { name: "Choose the Year" }).selectOption({ label: String(y) });
  const short = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  // Select by value (0-based month index): option labels are locale-dependent ("Sep" vs en-GB "Sept").
  await calendar.getByRole("combobox", { name: "Choose the Month" }).selectOption({ value: String(m - 1) });
  const long = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  await calendar.getByRole("button", { name: new RegExp(`${long} ${d}(st|nd|rd|th), ${y}`) }).click();
  await expect(calendar).toBeHidden();
  const display = `${d} ${short} ${y}`;
  await expect(trigger).toContainText(display);
}

/** Choose an option of a Radix Select (combobox) by its visible text. */
export async function chooseOption(page: Page, combobox: Locator, option: string | RegExp): Promise<void> {
  await combobox.click();
  await page.getByRole("option", { name: option }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

/** Native balance of an account row on /accounts, in minor units. */
export async function accountBalance(page: Page, accountName: string): Promise<number> {
  const row = page.locator(`[data-testid="account-row"][data-account="${accountName}"]`);
  return minorOf(row.getByTestId("account-balance"));
}

/** Add a spending through the "Add spending" dialog on /expenses. Returns once the dialog closed. */
export async function addSpending(
  page: Page,
  { amount, category, note, date }: { amount: string; category: string; note: string; date?: string },
): Promise<void> {
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add spending" });
  await dialog.getByRole("textbox", { name: "Amount" }).fill(amount);
  await chooseOption(page, dialog.getByRole("combobox", { name: "Category" }), category);
  if (date) await pickDate(page, dialog.getByRole("button", { name: "Date" }), date);
  await dialog.getByRole("textbox", { name: /^Note/ }).fill(note);
  await dialog.getByRole("button", { name: "Add spending" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Spending added").first()).toBeVisible();
}
