import { readFileSync } from "node:fs";
import { expect, test } from "./helpers";

test("add a category, then archive it", async ({ page }) => {
  const name = "E2E Pets";
  await page.goto("/settings?tab=categories");
  await page.getByRole("button", { name: "New category" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New category" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("radio", { name: "Green" }).click();
  await dialog.getByRole("radio", { name: "Paw print" }).click();
  await dialog.getByRole("button", { name: "Create category" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Category created").first()).toBeVisible();

  const active = page.locator("#active-categories");
  await expect(active.getByRole("row").filter({ hasText: name })).toBeVisible();

  // Offered in the spending dialog while active.
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  await page.getByRole("dialog", { name: "Add spending" }).getByRole("combobox", { name: "Category" }).click();
  await expect(page.getByRole("option", { name })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  // Archive it.
  await page.goto("/settings?tab=categories");
  await page.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByText(`“${name}” archived`).first()).toBeVisible();
  await expect(page.locator("#archived-categories").getByRole("row").filter({ hasText: name })).toBeVisible();
  await expect(active.getByRole("row").filter({ hasText: name })).toHaveCount(0);

  // No longer offered for new spendings.
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  await page.getByRole("dialog", { name: "Add spending" }).getByRole("combobox", { name: "Category" }).click();
  await expect(page.getByRole("option", { name: "Groceries" })).toBeVisible();
  await expect(page.getByRole("option", { name })).toHaveCount(0);
});

test("pin a category: it is listed first in the spending dialog and the Spendings filter", async ({ page }) => {
  const name = "Cash withdrawal"; // seeded
  await page.goto("/settings?tab=categories");
  const pin = page.getByRole("button", { name: `Pin ${name}` });
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await pin.click();
  await expect(page.getByText(`“${name}” pinned`).first()).toBeVisible();
  const unpin = page.getByRole("button", { name: `Unpin ${name}` });
  await expect(unpin).toHaveAttribute("aria-pressed", "true");
  // Pinned rows come first in Settings too.
  await expect(page.locator("#active-categories").getByRole("row").nth(1)).toContainText(name);

  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  await page.getByRole("dialog", { name: "Add spending" }).getByRole("combobox", { name: "Category" }).click();
  await expect(page.getByRole("group", { name: "Pinned" }).getByRole("option")).toHaveText([name]);
  await expect(page.getByRole("option").first()).toHaveText(name);
  await page.getByRole("option", { name }).click();
  await expect(page.getByRole("dialog", { name: "Add spending" }).getByRole("combobox", { name: "Category" })).toHaveText(name);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Filter by category: all categories" }).click();
  await expect(page.getByRole("group", { name: "Pinned" }).getByRole("option")).toHaveText([name]);
  await page.keyboard.press("Escape");

  // Unpin from the row menu: back in alphabetical order, no Pinned group.
  await page.goto("/settings?tab=categories");
  await page.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Unpin" }).click();
  await expect(page.getByRole("button", { name: `Pin ${name}` })).toHaveAttribute("aria-pressed", "false");
  await page.goto("/expenses");
  await page.getByRole("button", { name: /^Add (your first )?spending$/ }).first().click();
  await page.getByRole("dialog", { name: "Add spending" }).getByRole("combobox", { name: "Category" }).click();
  await expect(page.getByRole("group", { name: "Pinned" })).toHaveCount(0);
});

test("Taxes: advanced settings and the rules reference stay collapsed until opened", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: /^Employed/ })).toBeChecked();
  const optOut = page.getByRole("switch", { name: /I did not pay ЄСВ for 2024/ });
  await expect(optOut).toHaveCount(0);
  await page.getByRole("button", { name: "Advanced" }).click();
  await expect(optOut).toBeVisible();
  await expect(page.getByRole("heading", { name: "ЄСВ month by month" })).toBeVisible();

  const rules = page.getByRole("heading", { name: "Minimum wage & ЄСВ" });
  await expect(rules).toHaveCount(0);
  await page.getByRole("button", { name: "Rules reference" }).click();
  await expect(rules).toBeVisible();
  await expect(page.getByText("Your settings use the statutory rates.")).toBeVisible();
});

test("the Taxes category cannot be archived or deleted", async ({ page }) => {
  await page.goto("/settings?tab=categories");
  await page.getByRole("button", { name: "More actions for Taxes" }).click();
  await expect(page.getByRole("menuitem", { name: "Archive" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Delete/ })).toBeDisabled();
});

test("export downloads a valid JSON file with all data", async ({ page }) => {
  await page.goto("/settings?tab=data");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: /Export|Download/ }).first().click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^budget-export-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(readFileSync(await download.path(), "utf8")) as {
    app: string;
    version: number;
    exportedAt: string;
    data: Record<string, unknown> & { accounts: { name: string }[]; categories: { name: string }[]; settings: object };
  };
  expect(file.app).toBe("budget-tax-manager");
  expect(file.version).toBe(1);
  expect(Number.isNaN(Date.parse(file.exportedAt))).toBe(false);
  for (const key of ["accounts", "incomes", "expenses", "categories", "transfers", "adjustments", "settings"]) {
    expect(file.data, `data.${key}`).toHaveProperty(key);
  }
  expect(file.data.accounts.map((a) => a.name)).toEqual(
    expect.arrayContaining(["Main card", "FOP UAH", "FOP USD", "FOP EUR", "IBKR", "Deposits", "Other"]),
  );
  expect(file.data.categories.some((c) => c.name === "Taxes")).toBe(true);
});
