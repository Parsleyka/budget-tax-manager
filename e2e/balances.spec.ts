import { accountBalance, chooseOption, expect, minorOf, minorOrNull, moneyPattern, test } from "./helpers";

test("adding a salary increases the Active balance by exactly that amount", async ({ page }) => {
  await page.goto("/");
  const before = await minorOf(page.getByTestId("active-balance"));

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Add salary" }).click();
  const dialog = page.getByRole("dialog", { name: "Add salary" });
  await dialog.getByRole("textbox", { name: "Net amount" }).fill("12 345,67");
  await dialog.getByRole("textbox", { name: /^Employer/ }).fill("E2E Employer LLC");
  await dialog.getByRole("button", { name: "Add salary" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Salary added").first()).toBeVisible();

  await expect.poll(() => minorOrNull(page.getByTestId("active-balance"))).toBe(before + 1_234_567);
  await expect(page.getByTestId("recent-transactions")).toContainText("E2E Employer LLC");

  await page.goto("/income?kind=salary");
  const row = page.getByRole("row").filter({ hasText: "E2E Employer LLC" });
  await expect(row).toContainText(moneyPattern(1_234_567));
});

test("a cross-currency transfer FOP USD → Main card updates both balances", async ({ page }) => {
  await page.goto("/accounts");
  const usdBefore = await accountBalance(page, "FOP USD");
  const mainBefore = await accountBalance(page, "Main card");

  await page.getByRole("button", { name: "Transfer", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Transfer between accounts" });
  await chooseOption(page, dialog.getByRole("combobox", { name: "From" }), /^FOP USD/);
  await chooseOption(page, dialog.getByRole("combobox", { name: "To" }), /^Main card/);
  await dialog.getByRole("textbox", { name: "Amount sent" }).fill("500");
  // "Amount received" is prefilled at the NBU rate of the date; the user overrides it with what the bank paid.
  const received = dialog.getByRole("textbox", { name: "Amount received" });
  await expect(received).not.toHaveValue("");
  await received.fill("22 400,00");
  await dialog.getByRole("button", { name: "Transfer" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Transfer saved").first()).toBeVisible();

  await expect.poll(() => accountBalance(page, "FOP USD")).toBe(usdBefore - 50_000);
  await expect.poll(() => accountBalance(page, "Main card")).toBe(mainBefore + 2_240_000);
  // Effective rate of the sale: 22 400 / 500 = 44,8000 UAH per $.
  const transfers = page.locator("#transfers");
  await expect(transfers).toContainText("44,8000");
  await expect(transfers).toContainText(moneyPattern(50_000, "USD"));
});

test("select accounts to see their sum: one by one, a whole group, then clear", async ({ page }) => {
  await page.goto("/accounts");
  const count = page.getByTestId("accounts-selection-count");
  const total = page.getByTestId("accounts-total");
  await expect(count).toHaveCount(0);
  await expect(page.getByTestId("accounts-list")).toContainText("Net worth");

  const main = await accountBalance(page, "Main card");
  const deposits = await accountBalance(page, "Deposits");
  await page.getByRole("checkbox", { name: "Main card" }).click();
  await page.getByRole("checkbox", { name: "Deposits", exact: true }).click();
  await expect(count).toHaveText("2 selected");
  await expect.poll(() => minorOf(total)).toBe(main + deposits);
  await expect(page.getByTestId("accounts-selection-foreign")).toHaveCount(0);

  // A click on the name ticks the account too; a second tick takes it out of the sum.
  await page.locator('[data-account="Deposits"] label').click();
  await expect(count).toHaveText("1 selected");
  await expect.poll(() => minorOf(total)).toBe(main);

  // The group checkbox: all of it, then a partly selected group selects the rest.
  const group = page.getByRole("checkbox", { name: "Select all Freelancer accounts" });
  const inGroup = await page.locator("#group-freelancer").getByTestId("account-row").count();
  await group.click();
  await expect(count).toHaveText(`${inGroup + 1} selected`);
  await expect(page.getByTestId("accounts-selection-foreign")).toContainText("$");
  await page.getByRole("checkbox", { name: "FOP USD" }).click();
  await expect(group).toHaveAttribute("aria-checked", "mixed");
  await group.click();
  await expect(group).toBeChecked();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(count).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Main card" })).not.toBeChecked();
  await expect(page.getByTestId("accounts-list")).toContainText("Net worth");
});

test("an account set to “Never below 0” stops at 0 when more is spent from it", async ({ page }) => {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Actions for Other" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit account" });
  const neverNegative = dialog.getByRole("switch", { name: "Never below 0" });
  if (!(await neverNegative.isChecked())) await neverNegative.click();
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toBeHidden();

  const before = await accountBalance(page, "Other");
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  const spending = page.getByRole("dialog", { name: "Add spending" });
  await spending.getByRole("textbox", { name: "Amount" }).fill(String((before + 1_000_000) / 100).replace(".", ","));
  await chooseOption(page, spending.getByRole("combobox", { name: "Account" }), /^Other/);
  await chooseOption(page, spending.getByRole("combobox", { name: "Category" }), "Other");
  await spending.getByRole("button", { name: "Add spending" }).click();
  await expect(spending).toBeHidden();

  await page.goto("/accounts");
  await expect.poll(() => accountBalance(page, "Other")).toBe(0);
});

test("Update balance on IBKR records the difference as an adjustment", async ({ page }) => {
  await page.goto("/accounts");
  const before = await accountBalance(page, "IBKR");
  const target = before === 1_500_000 ? 1_600_000 : 1_500_000;

  await page.getByRole("button", { name: "Actions for IBKR" }).click();
  await page.getByRole("menuitem", { name: "Update balance" }).click();
  const dialog = page.getByRole("dialog", { name: "Update balance" });
  await dialog.getByRole("textbox", { name: "Actual balance" }).fill(String(target / 100).replace(".", ","));
  await expect(dialog.getByTestId("adjust-delta")).toContainText(moneyPattern(target - before, "USD"));
  await dialog.getByRole("button", { name: "Update balance" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Balance updated").first()).toBeVisible();

  await expect.poll(() => accountBalance(page, "IBKR")).toBe(target);
  await page.getByRole("tab", { name: /^Balance updates/ }).click();
  await expect(page.locator("#balance-updates").getByRole("row").filter({ hasText: "IBKR" }).first()).toContainText(
    moneyPattern(target - before, "USD"),
  );

  // The Overview counts IBKR in the Frozen balance (its group, in UAH).
  await page.goto("/");
  await expect(page.getByTestId("frozen-group-ibkr")).toContainText("Investments");
  await expect(page.getByTestId("frozen-group-ibkr")).toContainText("₴");
});
