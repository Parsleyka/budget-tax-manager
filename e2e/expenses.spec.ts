import { readFileSync } from "node:fs";
import path from "node:path";
import { E2E_DATA_DIR } from "../playwright.config";
import { addSpending, expect, moneyPattern, test } from "./helpers";

test("add, edit and delete a spending", async ({ page }) => {
  const note = "E2E weekly groceries";
  await addSpending(page, { amount: "850,40", category: "Groceries", note });

  const row = page.getByRole("row").filter({ hasText: note });
  await expect(row).toContainText(moneyPattern(85_040));
  await expect(row).toContainText("Groceries");

  // Edit: change the amount.
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit spending" });
  await expect(edit.getByRole("textbox", { name: "Amount" })).toHaveValue("850,40");
  await edit.getByRole("textbox", { name: "Amount" }).fill("900");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText("Spending updated").first()).toBeVisible();
  await expect(row).toContainText(moneyPattern(90_000));

  // Delete (always confirmed).
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this spending?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: note })).toHaveCount(0);
});

test("the filtered total follows the category filter", async ({ page }) => {
  await addSpending(page, { amount: "120", category: "Transport", note: "E2E metro" });
  await addSpending(page, { amount: "80,50", category: "Transport", note: "E2E bus" });

  const transportId = await page.evaluate(async () => {
    const res = await fetch("/api/export");
    const file = (await res.json()) as { data: { categories: { id: string; name: string }[] } };
    return file.data.categories.find((c) => c.name === "Transport")!.id;
  });
  await page.goto(`/expenses?category=${transportId}`);
  await expect(page.getByRole("row").filter({ hasText: "E2E metro" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "E2E bus" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Groceries" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Filter by category: Transport/ })).toBeVisible();
});

test("“By category” shows a new spending in its category and filters the list (Analytics merged in)", async ({ page }) => {
  await addSpending(page, { amount: "1 234", category: "Education", note: "E2E online course" });
  await expect(page.getByTestId("period-spent")).toBeVisible();

  // The breakdown lists the top 6 categories; earlier specs may have pushed Education below the fold.
  const showAll = page.getByRole("button", { name: /^Show all \d+$/ });
  if (await showAll.isVisible()) await showAll.click();
  const education = page.getByTestId("category-breakdown").getByRole("button", { name: /Education/ });
  await expect(education).toContainText(moneyPattern(123_400));

  // A row filters the list to that category; selecting it again clears the filter.
  await education.click();
  await expect(page).toHaveURL(/category=/);
  await expect(education).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Filter by category: Education/ })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "E2E online course" })).toBeVisible();
  await education.click();
  await expect(page).not.toHaveURL(/category=/);
  await expect(education).toHaveAttribute("aria-pressed", "false");

  // Old Analytics links land on Spendings with their period.
  await page.goto("/analytics?period=this-month");
  await expect(page).toHaveURL(/\/expenses\?period=this-month$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spendings");
});

test("data persists after a reload and is written to the data dir", async ({ page, browser }) => {
  const note = "E2E persisted spending";
  await addSpending(page, { amount: "42,42", category: "Health", note });

  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: note })).toContainText(moneyPattern(4_242));

  // A brand-new browser context (no client state) sees it too.
  const context = await browser.newContext();
  const fresh = await context.newPage();
  await fresh.goto("/expenses?period=all&q=persisted");
  await expect(fresh.getByRole("row").filter({ hasText: note })).toBeVisible();
  await context.close();

  // …and it is on disk in the e2e data dir (never ./data).
  const file = JSON.parse(readFileSync(path.join(E2E_DATA_DIR, "expenses.json"), "utf8")) as {
    version: number;
    items: { note?: string; amount: number }[];
  };
  expect(file.version).toBe(1);
  expect(file.items.find((e) => e.note === note)).toMatchObject({ amount: 42.42 });

  // The Overview's recent transactions list it as money out of the main card.
  await page.goto("/");
  await expect(page.getByTestId("recent-transactions")).toContainText(note);
  await expect(page.getByTestId("recent-expense").filter({ hasText: note })).toContainText(/−42,42/);
});
