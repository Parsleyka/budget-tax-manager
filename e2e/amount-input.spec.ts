import { addSpending, expect, moneyPattern, test } from "./helpers";

test("amount fields group thousands with spaces while typing and keep the caret in place", async ({ page }) => {
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add spending" });
  const amount = dialog.getByRole("textbox", { name: "Amount" });

  await amount.pressSequentially("100000000");
  await expect(amount).toHaveValue("100 000 000");

  await amount.fill("");
  await amount.pressSequentially("100000");
  await expect(amount).toHaveValue("100 000");
  // Caret after the group space ("100 |000"): Backspace removes the "0" before it, not just the space.
  await amount.press("ArrowLeft");
  await amount.press("ArrowLeft");
  await amount.press("ArrowLeft");
  await amount.press("Backspace");
  await expect(amount).toHaveValue("10 000");
  // The caret stayed after "10": typing goes in the middle, not at the end.
  await amount.pressSequentially("5");
  await expect(amount).toHaveValue("105 000");
  await amount.press("End");
  await amount.pressSequentially(",5");
  await expect(amount).toHaveValue("105 000,5");

  // An ambiguous thousands separator is still refused instead of being regrouped.
  await amount.fill("58.500");
  await expect(amount).toHaveValue("58.500");
  await dialog.getByRole("button", { name: "Add spending" }).click();
  await expect(dialog.getByText(/Ambiguous amount/)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("a grouped amount saves correctly and edit prefills it grouped", async ({ page }) => {
  const note = "E2E grouped amount";
  await addSpending(page, { amount: "1250000,75", category: "Travel", note });
  const row = page.getByRole("row").filter({ hasText: note });
  await expect(row).toContainText(moneyPattern(125_000_075));

  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit spending" });
  await expect(edit.getByRole("textbox", { name: "Amount" })).toHaveValue("1 250 000,75");
  await edit.getByRole("button", { name: "Cancel" }).click();

  // Clean up so other specs' totals stay readable.
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("alertdialog", { name: "Delete this spending?" }).getByRole("button", { name: "Delete" }).click();
  await expect(row).toHaveCount(0);
});
