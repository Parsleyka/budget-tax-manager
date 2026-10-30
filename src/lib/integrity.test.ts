import { describe, expect, it } from "vitest";
import { account, adjustment, category, expense, income, settings, transfer } from "@/test/factories";
import {
  canArchiveAccount,
  canArchiveCategory,
  canDeleteAccount,
  canDeleteCategory,
  checkAccountUpdate,
  checkCategoryName,
  checkDefaultActiveAccount,
  checkExpenseRefs,
  checkIncomeRefs,
  checkSnapshotIntegrity,
  checkTaxPayment,
  checkTransfer,
  isProblem,
} from "./integrity";
import type { DataSnapshot } from "./types";

const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH" });
const usd = account({ id: "usd", name: "FOP USD", group: "freelancer", currency: "USD" });
const old = account({ id: "old", name: "Old", group: "other", currency: "UAH", archived: true });
const unused = account({ id: "unused", name: "Unused", group: "deposits", currency: "UAH" });
const food = category({ id: "food", name: "Groceries" });
const taxes = category({ id: "tax", name: "Taxes", systemKey: "taxes", color: "red" });
const gone = category({ id: "gone", name: "Gone", archived: true });

function snap(over: Partial<DataSnapshot> = {}): DataSnapshot {
  return {
    accounts: [main, usd, old, unused],
    categories: [food, taxes, gone],
    incomes: [],
    expenses: [],
    transfers: [],
    adjustments: [],
    debts: [],
    investmentFlows: [],
    valuations: [],
    settings: settings({ defaultActiveAccountId: "main" }),
    ...over,
  };
}

describe("income / expense references", () => {
  it("currency must match the account", () => {
    expect(checkIncomeRefs({ kind: "freelance", currency: "USD", accountId: "usd" }, snap())).toBeNull();
    expect(checkIncomeRefs({ kind: "freelance", currency: "EUR", accountId: "usd" }, snap())?.fieldErrors).toHaveProperty("currency");
    expect(checkIncomeRefs({ kind: "salary", currency: "UAH", accountId: "main" }, snap())).toBeNull();
    expect(checkIncomeRefs({ kind: "salary", currency: "USD", accountId: "usd" }, snap())?.error).toMatch(/UAH/);
    expect(checkIncomeRefs({ kind: "salary", currency: "UAH", accountId: "nope" }, snap())?.fieldErrors).toHaveProperty("accountId");
  });
  it("archived accounts/categories are rejected for new records but allowed when unchanged on edit", () => {
    expect(checkIncomeRefs({ kind: "salary", currency: "UAH", accountId: "old" }, snap())?.error).toMatch(/archived/);
    expect(checkIncomeRefs({ kind: "salary", currency: "UAH", accountId: "old" }, snap(), { accountId: "old" })).toBeNull();
    expect(checkExpenseRefs({ accountId: "main", categoryId: "gone" }, snap())?.fieldErrors).toHaveProperty("categoryId");
    expect(checkExpenseRefs({ accountId: "main", categoryId: "gone" }, snap(), { accountId: "main", categoryId: "gone" })).toBeNull();
    expect(checkExpenseRefs({ accountId: "main", categoryId: "missing" }, snap())?.error).toMatch(/not found/);
  });
});

describe("transfers", () => {
  it("different accounts, same-currency amounts equal, cross-currency needs toAmount", () => {
    expect(checkTransfer({ fromAccountId: "main", toAccountId: "main", fromAmount: 1 }, snap())).toMatchObject({ error: "Choose two different accounts" });
    const same = checkTransfer({ fromAccountId: "main", toAccountId: "unused", fromAmount: 100 }, snap());
    expect(isProblem(same) ? null : same.toAmount).toBe(100);
    expect(isProblem(checkTransfer({ fromAccountId: "main", toAccountId: "unused", fromAmount: 100, toAmount: 99 }, snap()))).toBe(true);
    const fx = checkTransfer({ fromAccountId: "usd", toAccountId: "main", fromAmount: 100 }, snap());
    expect(isProblem(fx) && fx.fieldErrors).toHaveProperty("toAmount");
    const fxOk = checkTransfer({ fromAccountId: "usd", toAccountId: "main", fromAmount: 100, toAmount: 4485 }, snap());
    expect(isProblem(fxOk) ? null : fxOk.toAmount).toBe(4485);
  });
});

describe("delete / archive guards", () => {
  const used = snap({
    incomes: [income({ accountId: "usd", currency: "USD", rate: 40 })],
    expenses: [expense({ accountId: "main", categoryId: "food" })],
    transfers: [transfer({ fromAccountId: "usd", toAccountId: "main" })],
    adjustments: [adjustment({ accountId: "main" })],
  });
  it("accounts", () => {
    expect(canDeleteAccount("unused", used)).toBeNull();
    expect(canDeleteAccount("usd", used)?.error).toMatch(/Archive it instead/);
    expect(canDeleteAccount("main", used)?.error).toMatch(/default/);
    expect(canDeleteAccount("nope", used)?.error).toMatch(/not found/);
    expect(canArchiveAccount("main", used)?.error).toMatch(/default/);
    expect(canArchiveAccount("usd", used)).toBeNull();
  });
  it("categories", () => {
    expect(canDeleteCategory("food", used)?.error).toMatch(/Archive it instead/);
    expect(canDeleteCategory("tax", snap())?.error).toMatch(/Taxes/);
    expect(canDeleteCategory("gone", used)).toBeNull();
    expect(canArchiveCategory("tax", snap())?.error).toMatch(/Taxes/);
    expect(canArchiveCategory("food", snap())).toBeNull();
  });
  it("account updates", () => {
    expect(checkAccountUpdate(usd, { group: "freelancer", currency: "EUR" }, used)?.fieldErrors).toHaveProperty("currency");
    expect(checkAccountUpdate(unused, { group: "deposits", currency: "USD" }, used)).toBeNull();
    expect(checkAccountUpdate(main, { group: "other", currency: "UAH" }, used)?.fieldErrors).toHaveProperty("group");
    expect(checkAccountUpdate(unused, { group: "active", currency: "USD" }, used)?.error).toMatch(/UAH/);
  });
  it("category names are unique (case-insensitive)", () => {
    expect(checkCategoryName(" groceries ", snap().categories)?.fieldErrors).toHaveProperty("name");
    expect(checkCategoryName("Groceries", snap().categories, "food")).toBeNull();
    expect(checkCategoryName("Pets", snap().categories)).toBeNull();
  });
  it("tax payments need a UAH account and the Taxes category", () => {
    expect(isProblem(checkTaxPayment("usd", snap()))).toBe(true);
    const ok = checkTaxPayment("main", snap());
    expect(isProblem(ok) ? null : ok.taxCategory.id).toBe("tax");
    expect(isProblem(checkTaxPayment("main", snap({ categories: [food] })))).toBe(true);
  });
  it("default active account", () => {
    expect(checkDefaultActiveAccount("main", snap().accounts)).toBeNull();
    expect(checkDefaultActiveAccount("usd", snap().accounts)?.error).toMatch(/Active/);
    expect(checkDefaultActiveAccount("x", snap().accounts)).not.toBeNull();
  });
});

describe("whole-snapshot integrity (import)", () => {
  it("accepts a consistent snapshot", () => {
    expect(checkSnapshotIntegrity(snap())).toEqual([]);
  });
  it("reports dangling references, currency mismatches, duplicates", () => {
    const bad = snap({
      incomes: [income({ id: "i", accountId: "ghost" }), income({ id: "i2", accountId: "usd", currency: "UAH" })],
      expenses: [expense({ id: "e", accountId: "main", categoryId: "ghost-cat" })],
      transfers: [transfer({ id: "t", fromAccountId: "main", toAccountId: "unused", fromAmount: 1, toAmount: 2 })],
      adjustments: [adjustment({ id: "a", accountId: "ghost" })],
      categories: [food, food],
      settings: settings({ defaultActiveAccountId: "usd" }),
    });
    const problems = checkSnapshotIntegrity(bad);
    expect(problems).toEqual(
      expect.arrayContaining([
        "categories: duplicate id food",
        "income i: unknown account ghost",
        "income i2: currency UAH ≠ account currency USD",
        "expense e: unknown category ghost-cat",
        "transfer t: same-currency amounts differ",
        "adjustment a: unknown account ghost",
        "categories: expected exactly one Taxes category (found 0)",
      ]),
    );
    expect(problems.some((p) => p.startsWith("settings.defaultActiveAccountId"))).toBe(true);
  });
});
