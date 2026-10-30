import type { Locator, Page } from "@playwright/test";
import { accountBalance, chooseOption, expect, minorFromText, minorOf, moneyPattern, pickDate, test } from "./helpers";

/** "I borrowed money" lives in the page header's "…" menu. */
async function openBorrowed(page: Page) {
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "I borrowed money" }).click();
}

/** A debt row's "…" menu: Edit · Repayments (n) · Delete. */
async function debtAction(page: Page, item: Locator, counterparty: string, action: string | RegExp) {
  await item.getByRole("button", { name: `More actions for debt with ${counterparty}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** YYYY-MM-DD in Kyiv, `days` from today (negative = past). */
function kyivDate(days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test("lend money: overdue reminder (balances untouched), repayment into the card, repayment without an account, delete", async ({ page }) => {
  await page.goto("/");
  const activeBefore = await minorOf(page.getByTestId("active-balance"));
  const netWorthBefore = await minorOf(page.getByTestId("net-worth"));
  await page.goto("/accounts");
  const mainBefore = await accountBalance(page, "Main card");

  await page.goto("/debts");
  await page.getByRole("button", { name: "I lent money" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New debt" });
  // A separate tracker: no account to pick.
  await expect(dialog.getByRole("switch")).toHaveCount(0);
  await expect(dialog.getByText("Your account balances are not changed.")).toBeVisible();
  // A text box — or a combobox once earlier names are offered as suggestions.
  await dialog.getByLabel("Lent to").fill("E2E Oleh");
  await dialog.getByRole("textbox", { name: "Amount" }).fill("5 000");
  await pickDate(page, dialog.getByRole("button", { name: "Lent on" }), kyivDate(-20));
  await pickDate(page, dialog.getByRole("button", { name: /Return by/ }), kyivDate(-5));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Loan saved").first()).toBeVisible();

  const item = page.getByTestId("debt-item").filter({ hasText: "E2E Oleh" });
  await expect(item).toContainText("Overdue by 5 days");
  await expect(item.getByTestId("debt-outstanding")).toContainText(moneyPattern(500_000));
  await expect.poll(() => minorOf(page.getByTestId("owed-to-you"))).toBeGreaterThanOrEqual(500_000);
  // Reminder: the sidebar badge — while Active balance and net worth stay as they were.
  await expect(page.getByTestId("nav-badge-debts")).toHaveText(/^[1-9]\d*$/);
  await page.goto("/");
  await expect(page.getByTestId("recent-transactions").getByText("E2E Oleh")).toHaveCount(0);
  expect(await minorOf(page.getByTestId("active-balance"))).toBe(activeBefore);
  expect(await minorOf(page.getByTestId("net-worth"))).toBe(netWorthBefore);

  // Partial repayment.
  await page.goto("/debts");
  await item.getByRole("button", { name: "Got money back" }).click();
  const repay = page.getByRole("dialog", { name: "E2E Oleh paid you back" });
  await expect(repay.getByRole("textbox", { name: "Amount" })).toHaveValue("5 000,00");
  await repay.getByRole("textbox", { name: "Amount" }).fill("6 000");
  await repay.getByRole("button", { name: "Save repayment" }).click();
  await expect(repay.getByText("That's more than what is outstanding")).toBeVisible();
  await repay.getByRole("textbox", { name: "Amount" }).fill("2 000");
  await expect(repay.getByTestId("dialog-footer-summary")).toContainText(moneyPattern(300_000));
  // A UAH debt is received into the main card by default.
  await expect(repay.getByRole("combobox", { name: "Received into" })).toContainText("Main card");
  await expect(repay.getByText("Main card goes up by this repayment.")).toBeVisible();
  await repay.getByRole("button", { name: "Save repayment" }).click();
  await expect(repay).toBeHidden();
  await expect(page.getByText("Repayment saved").first()).toBeVisible();
  await expect(item.getByTestId("debt-outstanding")).toContainText(moneyPattern(300_000));
  await expect(item).toContainText("of 5 000,00");
  await page.goto("/accounts");
  await expect.poll(() => accountBalance(page, "Main card")).toBe(mainBefore + 200_000);
  // It shows on the Overview: the card balance changed.
  await page.goto("/");
  await expect(page.getByTestId("recent-transactions")).toContainText("E2E Oleh repaid");
  await page.goto("/debts");

  // Full repayment with no account (e.g. cash) settles it without touching any balance.
  await item.getByRole("button", { name: "Got money back" }).click();
  await chooseOption(page, repay.getByRole("combobox", { name: "Received into" }), /^None/);
  await expect(repay.getByText(/No balance changes/)).toBeVisible();
  await repay.getByRole("button", { name: "Save repayment" }).click();
  await expect(page.getByText(/Settled — E2E Oleh/).first()).toBeVisible();
  await expect(page.getByTestId("debt-item").filter({ hasText: "E2E Oleh" })).toHaveCount(0);

  await page.goto("/debts?view=settled");
  const settled = page.getByTestId("debt-item").filter({ hasText: "E2E Oleh" });
  await expect(settled).toContainText("Settled");
  await debtAction(page, settled, "E2E Oleh", "Repayments (2)");
  const history = settled.getByRole("list", { name: "Repayments for E2E Oleh" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history.getByTestId("repayment-account")).toHaveText(["No account", "into Main card"]);
  await page.goto("/accounts");
  await expect.poll(() => accountBalance(page, "Main card")).toBe(mainBefore + 200_000);
  await page.goto("/debts?view=settled");

  // Deleting the whole debt removes it and its repayments.
  await debtAction(page, settled, "E2E Oleh", "Delete");
  const confirm = page.getByRole("alertdialog", { name: "Delete the debt with E2E Oleh?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId("debt-item").filter({ hasText: "E2E Oleh" })).toHaveCount(0);

  await page.goto("/accounts");
  expect(await accountBalance(page, "Main card")).toBe(mainBefore);
});

test("borrowed USD counts in “You owe” and changes no balance", async ({ page }) => {
  await page.goto("/accounts");
  const usdBefore = await accountBalance(page, "FOP USD");
  const mainBefore = await accountBalance(page, "Main card");

  await page.goto("/debts");
  await openBorrowed(page);
  const dialog = page.getByRole("dialog", { name: "New debt" });
  await expect(dialog.getByRole("radio", { name: /I borrowed/ })).toBeChecked();
  await dialog.getByLabel("Borrowed from").fill("E2E Ira");
  await dialog.getByRole("textbox", { name: "Amount" }).fill("150");
  await dialog.getByRole("radio", { name: "USD" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Debt saved").first()).toBeVisible();

  const item = page.getByTestId("debts-borrowed").getByTestId("debt-item").filter({ hasText: "E2E Ira" });
  // No due date → no due label at all.
  await expect(item).not.toContainText(/Due|Overdue/);
  await expect(item.getByTestId("debt-outstanding")).toContainText(moneyPattern(15_000, "USD"));
  await expect.poll(() => minorOf(page.getByTestId("you-owe"))).toBeGreaterThan(0);

  await page.goto("/accounts");
  expect(await accountBalance(page, "FOP USD")).toBe(usdBefore);
  expect(await accountBalance(page, "Main card")).toBe(mainBefore);

  await page.goto("/debts");
  await debtAction(page, item, "E2E Ira", "Delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(item).toHaveCount(0);
});

test("a debt in Polish złoty: shown in zł, counted in UAH at the NBU rate; PLN rate in the header", async ({ page }) => {
  await page.goto("/debts");
  await expect(page.getByTestId("header-rates")).toContainText("PLN");
  await openBorrowed(page);
  const dialog = page.getByRole("dialog", { name: "New debt" });
  await dialog.getByLabel("Borrowed from").fill("E2E Kasia");
  await dialog.getByRole("textbox", { name: "Amount" }).fill("1 500");
  await dialog.getByRole("radio", { name: "PLN" }).click();
  await expect(dialog.getByRole("textbox", { name: "Amount" })).toHaveValue("1 500");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();

  const item = page.getByTestId("debts-borrowed").getByTestId("debt-item").filter({ hasText: "E2E Kasia" });
  await expect(item.getByTestId("debt-outstanding")).toContainText(/1\s500,00\szł/);
  // "You owe" is in UAH (1 500 zł at today's NBU rate) and lists the złoty amount.
  await expect.poll(() => minorOf(page.getByTestId("you-owe"))).toBeGreaterThan(150_000);
  await expect(page.getByText(/1\s500,00\szł/).first()).toBeVisible();

  // Pay 500 zł back from the UAH main card: no PLN account, so the default is "None"; pick the card and
  // the hryvnia amount is prefilled at the NBU rate.
  await page.goto("/accounts");
  const mainBefore = await accountBalance(page, "Main card");
  await page.goto("/debts");
  await item.getByRole("button", { name: "Paid back" }).click();
  const repay = page.getByRole("dialog", { name: "You paid E2E Kasia back" });
  await expect(repay.getByRole("combobox", { name: "Paid from" })).toContainText("None");
  await repay.getByRole("textbox", { name: "Amount" }).fill("500");
  await chooseOption(page, repay.getByRole("combobox", { name: "Paid from" }), /^Main card/);
  const uah = repay.getByRole("textbox", { name: "Amount paid from Main card" });
  await expect(uah).not.toHaveValue("");
  const uahMinor = minorFromText(await uah.inputValue());
  expect(uahMinor).toBeGreaterThan(50_000 * 5); // 500 zł is several thousand ₴
  await repay.getByRole("button", { name: "Save repayment" }).click();
  await expect(repay).toBeHidden();
  await expect(item.getByTestId("debt-outstanding")).toContainText(/1\s000,00\szł/);
  await page.goto("/accounts");
  await expect.poll(() => accountBalance(page, "Main card")).toBe(mainBefore - uahMinor);
  await page.goto("/debts");

  await debtAction(page, item, "E2E Kasia", "Delete");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(item).toHaveCount(0);
});
