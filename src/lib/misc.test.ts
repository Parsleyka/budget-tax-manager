import { describe, expect, it } from "vitest";
import { account, adjustment, category, expense, income, settings, transfer } from "@/test/factories";
import {
  assignChartColors,
  CATEGORY_COLOR_ORDER,
  CATEGORY_COLORS,
  categoryColorHex,
  categoryColorVar,
  foldToOther,
  isPinned,
  isValidCategoryColor,
  SEED_CATEGORIES,
  sortCategories,
  splitPinned,
} from "./categories";
import {
  AccountInputSchema,
  ExpenseInputSchema,
  ExportFileSchema,
  IncomeInputSchema,
  IncomeSchema,
  SettingsInputSchema,
  TaxPaymentInputSchema,
  TaxSettingsSchema,
  TransferInputSchema,
  zodFieldErrors,
} from "./schemas";
import { buildTransactions, recentTransactions } from "./transactions";

describe("category palette", () => {
  it("has the validated 8 hues in order + gray", () => {
    expect(CATEGORY_COLOR_ORDER).toEqual(["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"]);
    expect(CATEGORY_COLORS.blue).toMatchObject({ light: "#2a78d6", dark: "#3987e5" });
  });
  it("css var / hex helpers", () => {
    expect(categoryColorVar("blue")).toBe("var(--cat-blue)");
    expect(categoryColorVar("#123456")).toBe("#123456");
    expect(categoryColorVar("nonsense")).toBe("var(--cat-gray)");
    expect(categoryColorHex("violet", "dark")).toBe("#9085e9");
    expect(isValidCategoryColor("red")).toBe(true);
    expect(isValidCategoryColor("#abc")).toBe(false);
  });
  it("seed categories: 15 incl. one Taxes system category, all colors valid", () => {
    expect(SEED_CATEGORIES).toHaveLength(15);
    expect(SEED_CATEGORIES.filter((c) => c.systemKey === "taxes").map((c) => c.name)).toEqual(["Taxes"]);
    expect(SEED_CATEGORIES.every((c) => isValidCategoryColor(c.color))).toBe(true);
    expect(SEED_CATEGORIES.find((c) => c.name === "Cash withdrawal")).toMatchObject({ icon: "Banknote" });
  });
  it("pinned categories come first (then by name); an archived one is never treated as pinned", () => {
    const list = [
      category({ id: "t", name: "Transport" }),
      category({ id: "c", name: "Cash withdrawal", pinned: true }),
      category({ id: "a", name: "Apps" }),
      category({ id: "g", name: "Groceries", pinned: true }),
      category({ id: "x", name: "Archived pin", pinned: true, archived: true }),
    ];
    expect(sortCategories(list).map((c) => c.id)).toEqual(["c", "g", "a", "x", "t"]);
    expect(isPinned(list[4])).toBe(false);
    const { pinned, others } = splitPinned(sortCategories(list));
    expect(pinned.map((c) => c.id)).toEqual(["c", "g"]);
    expect(others.map((c) => c.id)).toEqual(["a", "x", "t"]);
    expect(list.map((c) => c.id)).toEqual(["t", "c", "a", "g", "x"]); // not mutated
  });
  it("assignChartColors keeps own colors and resolves clashes in slot order", () => {
    const m = assignChartColors([
      { id: "a", color: "blue" },
      { id: "b", color: "blue" },
      { id: "c", color: "orange" },
      { id: "o", color: "gray" },
    ]);
    expect(Object.fromEntries(m)).toEqual({ a: "blue", b: "aqua", c: "orange", o: "gray" });
  });
  it("foldToOther", () => {
    const rows = [1, 2, 3, 4, 5];
    expect(foldToOther(rows, 3, (rest) => rest.reduce((s, x) => s + x, 0))).toEqual([1, 2, 12]);
    expect(foldToOther(rows, 5, () => 0)).toEqual(rows);
  });
});

describe("schemas", () => {
  it("IncomeSchema enforces amountUah consistency and salary rules", () => {
    expect(IncomeSchema.safeParse(income({ currency: "USD", amount: 100, rate: 41.5 })).success).toBe(true);
    expect(IncomeSchema.safeParse({ ...income({ currency: "USD", amount: 100, rate: 41.5 }), amountUah: 4150.01 }).success).toBe(false);
    expect(IncomeSchema.safeParse(income({ kind: "salary", currency: "USD", rate: 40 })).success).toBe(false);
    expect(IncomeSchema.safeParse({ ...income({}), rate: 1.5 }).success).toBe(false); // UAH must be 1
    expect(IncomeSchema.safeParse(income({ amount: 100, fee: 100 })).success).toBe(false);
  });
  it("IncomeInputSchema", () => {
    const base = { kind: "freelance", date: "2026-10-09", amount: 1000, currency: "USD", accountId: "x" } as const;
    const ok = IncomeInputSchema.safeParse(base);
    expect(ok.success && ok.data.rateSource).toBe("nbu");
    expect(IncomeInputSchema.safeParse({ ...base, amount: 10.001 }).success).toBe(false);
    expect(IncomeInputSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(IncomeInputSchema.safeParse({ ...base, date: "2026-02-30" }).success).toBe(false);
    const manual = IncomeInputSchema.safeParse({ ...base, rateSource: "manual" });
    expect(manual.success).toBe(false);
    if (!manual.success) expect(zodFieldErrors(manual.error)).toHaveProperty("rate");
    expect(IncomeInputSchema.safeParse({ ...base, rateSource: "manual", rate: 44.12345 }).success).toBe(false);
    expect(IncomeInputSchema.safeParse({ ...base, kind: "salary" }).success).toBe(false);
    const withNote = IncomeInputSchema.parse({ ...base, note: "  ", counterparty: " ACME " });
    expect(withNote.note).toBeUndefined();
    expect(withNote.counterparty).toBe("ACME");
  });
  it("Expense / transfer / tax payment / account inputs", () => {
    expect(ExpenseInputSchema.safeParse({ date: "2026-10-01", amount: 5, accountId: "a", categoryId: "c" }).success).toBe(true);
    expect(TransferInputSchema.safeParse({ date: "2026-10-01", fromAccountId: "a", toAccountId: "a", fromAmount: 1 }).success).toBe(false);
    const dup = TaxPaymentInputSchema.safeParse({
      date: "2026-10-01",
      accountId: "a",
      period: "2026-Q3",
      payments: [
        { kind: "esv", amount: 1 },
        { kind: "esv", amount: 2 },
      ],
    });
    expect(dup.success).toBe(false);
    if (!dup.success) expect(Object.keys(zodFieldErrors(dup.error))).toContain("payments.1.kind");
    expect(TaxPaymentInputSchema.safeParse({ date: "2026-10-01", accountId: "a", period: "2026-Q5", payments: [{ kind: "esv", amount: 1 }] }).success).toBe(false);
    expect(AccountInputSchema.safeParse({ name: "X", group: "active", currency: "USD" }).success).toBe(false);
    expect(AccountInputSchema.parse({ name: "X", group: "ibkr", currency: "USD" }).openingBalance).toBe(0);
  });
  it("tax settings", () => {
    expect(TaxSettingsSchema.safeParse(settings().tax).success).toBe(true);
    expect(TaxSettingsSchema.safeParse({ ...settings().tax, employedFrom: "2026-05-01", employedTo: "2026-01-01" }).success).toBe(false);
    expect(TaxSettingsSchema.safeParse({ ...settings().tax, singleTaxRateOverridePct: 101 }).success).toBe(false);
    expect(TaxSettingsSchema.safeParse({ ...settings().tax, esvUncoveredMonths: ["2026-13"] }).success).toBe(false);
    expect(SettingsInputSchema.safeParse({ tax: { vatPayer: true } }).success).toBe(true);
  });
  it("ExportFileSchema", () => {
    const file = {
      app: "budget-tax-manager",
      version: 1,
      exportedAt: "2026-10-15T10:00:00.000Z",
      data: { accounts: [], incomes: [], expenses: [], categories: [], transfers: [], adjustments: [], settings: settings() },
    };
    expect(ExportFileSchema.safeParse(file).success).toBe(true);
    expect(ExportFileSchema.safeParse({ ...file, app: "other" }).success).toBe(false);
  });
});

describe("transactions", () => {
  const main = account({ id: "m", name: "Main card" });
  const usd = account({ id: "u", name: "FOP USD", group: "freelancer", currency: "USD" });
  const food = category({ id: "f", name: "Groceries", color: "blue", icon: "ShoppingCart" });
  const data = {
    accounts: [main, usd],
    categories: [food],
    incomes: [
      income({ id: "i1", kind: "freelance", accountId: "u", currency: "USD", amount: 100, rate: 40, date: "2026-10-10", counterparty: "ACME" }),
    ],
    expenses: [expense({ id: "e1", accountId: "m", categoryId: "f", amount: 50, date: "2026-10-12", note: "milk" })],
    transfers: [transfer({ id: "t1", fromAccountId: "u", toAccountId: "m", fromAmount: 50, toAmount: 2000, date: "2026-10-11" })],
    adjustments: [adjustment({ id: "a1", accountId: "m", delta: -25, date: "2026-10-12", createdAt: "2026-10-12T10:00:00.000Z" })],
  };
  it("builds a unified, newest-first list", () => {
    const rows = buildTransactions(data);
    expect(rows.map((r) => r.key)).toEqual(["adjustment:a1", "expense:e1", "transfer:t1", "income:i1"]);
    expect(rows[0]).toMatchObject({ direction: "out", amount: 25, currency: "UAH", title: "Balance update" });
    expect(rows[1]).toMatchObject({ title: "Groceries", categoryColor: "blue", subtitle: "milk", amountUah: 50 });
    expect(rows[2]).toMatchObject({ direction: "neutral", currency: "USD", toAmount: 2000, toCurrency: "UAH", amountUah: null, subtitle: "FOP USD → Main card" });
    expect(rows[3]).toMatchObject({ title: "Freelance · ACME", amountUah: 4000, incomeKind: "freelance" });
    expect(recentTransactions(data, 2)).toHaveLength(2);
  });
});
