import type { Locator, Page } from "@playwright/test";
import { accountBalance, chooseOption, expect, minorOf, pickDate, test } from "./helpers";

test.describe.configure({ mode: "serial" });

const card = (page: Page) => page.getByTestId("investment-card-IBKR");
const stat = (c: Locator, id: "value" | "deposited" | "gain") => minorOf(c.getByTestId(`investment-${id}`).locator("dd").first());

/** An account row's "…" menu (Deposit / withdrawal, Update value / balance). */
async function rowAction(page: Page, c: Locator, item: string) {
  await c.getByRole("button", { name: /^More actions for / }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** Open the row's details (deposited, chart, history) — collapsed by default. */
async function expand(c: Locator) {
  const toggle = c.getByRole("button", { name: /details/ });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function addFlow(page: Page, { amount, date, from }: { amount: string; date?: string; from?: RegExp }) {
  await rowAction(page, card(page), "Deposit / withdrawal");
  const dialog = page.getByRole("dialog", { name: "Deposit or withdrawal" });
  await expect(dialog.getByRole("radio", { name: "Deposit" })).toBeChecked();
  await dialog.getByRole("textbox", { name: "Amount" }).fill(amount);
  if (from) await chooseOption(page, dialog.getByRole("combobox", { name: "Money came from" }), from);
  if (date) await pickDate(page, dialog.getByRole("button", { name: "Date" }), date);
  await dialog.getByRole("button", { name: "Save deposit" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Deposit saved").first()).toBeVisible();
}

test("track deposits and the value of IBKR: gain, order independence, real transfers, Frozen", async ({ page }) => {
  await page.goto("/accounts");
  const fopBefore = await accountBalance(page, "FOP USD");

  await page.goto("/investments");
  const c = card(page);
  await expect(c).toBeVisible();

  // 1) An old deposit from outside (made before tracking) and today's value.
  await addFlow(page, { amount: "10 000", date: "2025-01-10" });
  await rowAction(page, c, "Update value");
  const val = page.getByRole("dialog", { name: "Update value" });
  await val.getByRole("textbox", { name: "Current value" }).fill("12 500");
  await expect(val.getByTestId("valuation-preview")).toContainText("+2 500,00");
  await val.getByRole("button", { name: "Update value" }).click();
  await expect(val).toBeHidden();
  await expect(page.getByText("Value updated").first()).toBeVisible();
  await expect.poll(() => stat(c, "value")).toBe(1_250_000);
  await expand(c);
  expect(await stat(c, "deposited")).toBe(1_000_000);
  expect(await stat(c, "gain")).toBe(250_000);
  await expect(c.getByTestId("investment-gain")).toContainText("+25,0%");

  // 2) A deposit from FOP USD is a real transfer: FOP USD goes down, IBKR value and principal go up.
  await addFlow(page, { amount: "1 000", from: /^FOP USD/ });
  await expect.poll(() => stat(c, "value")).toBe(1_350_000);
  expect(await stat(c, "deposited")).toBe(1_100_000);
  expect(await stat(c, "gain")).toBe(250_000);

  // 3) Adding an even older deposit later changes the gain, never the value.
  await addFlow(page, { amount: "500", date: "2024-05-01" });
  await expect.poll(() => stat(c, "deposited")).toBe(1_150_000);
  expect(await stat(c, "value")).toBe(1_350_000);
  expect(await stat(c, "gain")).toBe(200_000);
  await expect(c.getByTestId("investment-movement")).toHaveCount(3);
  await c.getByRole("tab", { name: /Value updates/ }).click();
  await expect(c.getByTestId("investment-valuation")).toHaveCount(1);

  // 4) Delete the old deposit again.
  await c.getByRole("tab", { name: /Deposits & withdrawals/ }).click();
  await c.getByRole("button", { name: /^Actions for deposit of 500,00 \$ on 1 May 2024/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect.poll(() => stat(c, "gain")).toBe(250_000);

  await page.goto("/accounts");
  await expect.poll(() => accountBalance(page, "FOP USD")).toBe(fopBefore - 100_000);
  await expect.poll(() => accountBalance(page, "IBKR")).toBe(1_350_000);

  // 5) The value is part of Frozen, under "Investments".
  await page.goto("/");
  const frozen = page.getByRole("region", { name: /Frozen/ }).or(page.locator("section, div").filter({ hasText: /Frozen/ })).first();
  await expect(frozen).toContainText("Investments");
  await expect(page.getByTestId("frozen-balance")).not.toHaveText(/^0,00/);
});

test("bank deposits on the Investments page: add one, top up from the card, balance with interest, interest earned", async ({ page }) => {
  await page.goto("/accounts");
  const mainBefore = await accountBalance(page, "Main card");

  // A deposit account of its own (so other specs using "Deposits" are not affected).
  await page.goto("/investments");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add bank deposit" }).click();
  const create = page.getByRole("dialog", { name: /account/i });
  await create.getByRole("textbox", { name: "Name" }).fill("E2E Savings");
  await create.getByRole("button", { name: /^(Add|Create|Save)/ }).click();
  await expect(create).toBeHidden();

  await expect(page.getByRole("heading", { level: 2, name: "Bank deposits" })).toBeVisible();
  const c = page.getByTestId("investment-card-E2E Savings");
  await expect(c).toContainText("Interest earned");

  // Top up 20 000 ₴ from the main card (a real transfer).
  await rowAction(page, c, "Deposit / withdrawal");
  const dialog = page.getByRole("dialog", { name: "Deposit or withdrawal" });
  await expect(dialog.getByRole("combobox", { name: "Account" })).toContainText("E2E Savings");
  await dialog.getByRole("textbox", { name: "Amount" }).fill("20 000");
  await chooseOption(page, dialog.getByRole("combobox", { name: "Money came from" }), /^Main card/);
  await dialog.getByRole("button", { name: "Save deposit" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => stat(c, "value")).toBe(2_000_000);

  // The bank shows 20 500 ₴ with interest.
  await rowAction(page, c, "Update balance");
  const val = page.getByRole("dialog", { name: "Update balance" });
  await val.getByRole("textbox", { name: "Current balance (with interest)" }).fill("20 500");
  await expect(val.getByTestId("valuation-preview")).toContainText("Interest earned");
  await val.getByRole("button", { name: "Update balance" }).click();
  await expect(val).toBeHidden();
  await expect.poll(() => stat(c, "gain")).toBe(50_000);
  await expand(c);
  expect(await stat(c, "deposited")).toBe(2_000_000);
  await expect(c.getByTestId("investment-gain")).toContainText("+2,5%");

  await page.goto("/accounts");
  await expect.poll(() => accountBalance(page, "Main card")).toBe(mainBefore - 2_000_000);
  await expect.poll(() => accountBalance(page, "E2E Savings")).toBe(2_050_000);
});
