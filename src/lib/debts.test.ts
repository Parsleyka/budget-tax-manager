import { describe, expect, it } from "vitest";
import { account, debt, repayment } from "@/test/factories";
import {
  compareDebts,
  debtStatus,
  dueLabel,
  outstandingMinor,
  overdueDebtCount,
  sideTotals,
  summarizeDebts,
  withStatus,
} from "./debts";
import { checkDebtUpdate, checkRepayment, checkSnapshotIntegrity } from "./integrity";
import { accountUsage, balanceSheet, computeBalances, type FxRates } from "./ledger";
import { DebtSchema, DebtsFileSchema } from "./schemas";
import { buildTransactions } from "./transactions";
import type { DataSnapshot } from "./types";

const TODAY = "2026-10-23";
const fx: FxRates = { USD: { rate: 41.5, date: TODAY, stale: false }, EUR: { rate: 48.25, date: TODAY, stale: true } };

describe("debtStatus", () => {
  it("tracks repaid / outstanding / progress and settles on the repayment that covers the amount", () => {
    const d = debt({
      amount: 1000,
      repayments: [repayment({ date: "2026-03-01", amount: 400 }), repayment({ date: "2026-02-01", amount: 250.5 })],
    });
    expect(debtStatus(d, TODAY)).toMatchObject({ repaid: 650.5, outstanding: 349.5, settled: false, settledOn: null, lastRepaymentDate: "2026-03-01" });
    expect(debtStatus(d, TODAY).progress).toBeCloseTo(0.6505, 6);
    const done = { ...d, repayments: [...d.repayments, repayment({ date: "2026-04-01", amount: 349.5 })] };
    expect(debtStatus(done, TODAY)).toMatchObject({ outstanding: 0, settled: true, settledOn: "2026-04-01", dueState: "settled", progress: 1 });
  });

  it("classifies the due date relative to today", () => {
    const at = (dueDate: string | undefined) => debtStatus(debt({ dueDate }), TODAY);
    expect(at(undefined)).toMatchObject({ dueState: "no-due-date", daysUntilDue: null });
    expect(at("2026-10-20")).toMatchObject({ dueState: "overdue", daysUntilDue: -3 });
    expect(at(TODAY)).toMatchObject({ dueState: "due-today", daysUntilDue: 0 });
    expect(at("2026-10-24")).toMatchObject({ dueState: "due-soon", daysUntilDue: 1 });
    expect(at("2026-10-30")).toMatchObject({ dueState: "due-soon", daysUntilDue: 7 });
    expect(at("2026-10-31")).toMatchObject({ dueState: "upcoming", daysUntilDue: 8 });
    // A settled debt is never overdue.
    const paid = debt({ dueDate: "2026-01-01", repayments: [repayment({ amount: 1000 })] });
    expect(debtStatus(paid, TODAY)).toMatchObject({ dueState: "settled", daysUntilDue: null });
  });

  it("labels due states", () => {
    expect(dueLabel({ dueState: "overdue", daysUntilDue: -1 })).toBe("Overdue by 1 day");
    expect(dueLabel({ dueState: "overdue", daysUntilDue: -12 })).toBe("Overdue by 12 days");
    expect(dueLabel({ dueState: "due-today", daysUntilDue: 0 })).toBe("Due today");
    expect(dueLabel({ dueState: "due-soon", daysUntilDue: 1 })).toBe("Due tomorrow");
    expect(dueLabel({ dueState: "upcoming", daysUntilDue: 30 })).toBe("Due in 30 days");
    expect(dueLabel({ dueState: "no-due-date", daysUntilDue: null })).toBe("No due date");
  });

  it("respects asOf (repayments and debts after it don't count)", () => {
    const d = debt({ date: "2026-05-01", amount: 500, repayments: [repayment({ date: "2026-06-01", amount: 200 })] });
    expect(outstandingMinor(d, { asOf: "2026-04-30" })).toBe(0);
    expect(outstandingMinor(d, { asOf: "2026-05-31" })).toBe(50_000);
    expect(outstandingMinor(d)).toBe(30_000);
  });
});

describe("ordering and summaries", () => {
  it("sorts overdue → due today → due soon → upcoming → no due date → settled", () => {
    const rows = withStatus(
      [
        debt({ id: "none-old", date: "2026-01-01" }),
        debt({ id: "settled", repayments: [repayment({ amount: 1000, date: "2026-09-01" })] }),
        debt({ id: "upcoming", dueDate: "2026-12-01" }),
        debt({ id: "overdue-2", dueDate: "2026-10-21" }),
        debt({ id: "soon", dueDate: "2026-10-25" }),
        debt({ id: "overdue-10", dueDate: "2026-10-13" }),
        debt({ id: "today", dueDate: TODAY }),
        debt({ id: "none-new", date: "2026-08-01" }),
      ],
      TODAY,
    );
    expect(rows.map((r) => r.debt.id)).toEqual(["overdue-10", "overdue-2", "today", "soon", "upcoming", "none-old", "none-new", "settled"]);
    expect(compareDebts(rows[0], rows[0])).toBe(0);
  });

  it("totals each side per currency and in UAH; missing rates make it incomplete", () => {
    const debts = [
      debt({ counterparty: "Oleh", amount: 1000, currency: "UAH" }),
      debt({ counterparty: "oleh ", amount: 100, currency: "USD", repayments: [repayment({ amount: 40 })] }),
      debt({ counterparty: "Ira", amount: 10, currency: "EUR" }),
      debt({ counterparty: "Paid", amount: 5, repayments: [repayment({ amount: 5 })] }),
      debt({ direction: "borrowed", counterparty: "Bank", amount: 300 }),
    ];
    const lent = sideTotals(debts, "lent", fx);
    expect(lent).toMatchObject({ byCurrency: { UAH: 1000, USD: 60, EUR: 10 }, count: 3, people: 2, incomplete: false, stale: true });
    // 1000 + 60 × 41,5 + 10 × 48,25
    expect(lent.totalUah).toBe(1000 + 2490 + 482.5);
    expect(sideTotals(debts, "borrowed", fx)).toMatchObject({ totalUah: 300, count: 1 });
    const noEur = sideTotals(debts, "lent", { USD: fx.USD });
    expect(noEur).toMatchObject({ incomplete: true, missingRates: ["EUR"], totalUah: 3490 });
  });

  it("summarizes attention items, overdue count and the next due debt", () => {
    const debts = [
      debt({ id: "late", dueDate: "2026-10-01" }),
      debt({ id: "soon", dueDate: "2026-10-26", direction: "borrowed" }),
      debt({ id: "later", dueDate: "2026-11-20" }),
      debt({ id: "paid", dueDate: "2026-09-01", repayments: [repayment({ amount: 1000 })] }),
    ];
    const s = summarizeDebts(debts, fx, TODAY);
    expect(s.attention.map((r) => r.debt.id)).toEqual(["late", "soon"]);
    expect(s.overdueCount).toBe(1);
    expect(s.nextDue?.debt.id).toBe("soon");
    expect(s.hasOpen).toBe(true);
    expect(overdueDebtCount(debts, TODAY)).toBe(1);
    expect(summarizeDebts([], fx, TODAY)).toMatchObject({ hasOpen: false, nextDue: null, overdueCount: 0, attention: [] });
  });
});

describe("debts are a separate tracker", () => {
  const main = account({ id: "main", group: "active", currency: "UAH", openingBalance: 10_000 });
  const usd = account({ id: "usd", group: "freelancer", currency: "USD", openingBalance: 300 });
  const base = { accounts: [main, usd], incomes: [], expenses: [], transfers: [], adjustments: [] };

  it("never change account balances, Active / Frozen or net worth", () => {
    const withDebts: Pick<DataSnapshot, "accounts" | "incomes" | "expenses" | "transfers" | "adjustments" | "debts"> = {
      ...base,
      debts: [
        debt({ direction: "lent", amount: 3000, repayments: [repayment({ amount: 1000 })] }),
        debt({ direction: "borrowed", amount: 200, currency: "USD" }),
      ],
    };
    expect(computeBalances(withDebts)).toEqual(computeBalances(base));
    expect(balanceSheet(withDebts, fx)).toEqual(balanceSheet(base, fx));
    expect(balanceSheet(withDebts, fx)).toMatchObject({ activeUah: 10_000, netWorthUah: 10_000 + 300 * 41.5 });
    expect(accountUsage("main", withDebts).total).toBe(0);
  });

  it("files from the first version load: the debt's own account link is dropped, a repayment's is kept", () => {
    const legacy = {
      version: 1,
      items: [{ ...debt({ id: "old" }), accountId: "main", repayments: [{ ...repayment({ id: "r1" }), accountId: "main" }] }],
    };
    const parsed = DebtsFileSchema.parse(legacy);
    expect(parsed.items[0]).not.toHaveProperty("accountId");
    // Repayments into / from an account are a feature: that money really arrived / left.
    expect(parsed.items[0].repayments[0]).toHaveProperty("accountId", "main");
    expect(parsed.items[0]).toMatchObject({ id: "old", counterparty: "Oleh", amount: 1000 });
  });
});

describe("debt integrity", () => {
  it("limits repayments to what is outstanding and to dates on/after the debt", () => {
    const d = debt({ date: "2026-03-01", amount: 1000, repayments: [repayment({ date: "2026-04-01", amount: 600 })] });
    expect(checkRepayment(d, { amount: 400, date: "2026-05-01" })).toBeNull();
    expect(checkRepayment(d, { amount: 400.01, date: "2026-05-01" })?.fieldErrors?.amount?.[0]).toMatch(/Only 400,00/);
    expect(checkRepayment(d, { amount: 10, date: "2026-02-28" })?.fieldErrors?.date).toBeDefined();
    const paid = { ...d, repayments: [repayment({ amount: 1000, date: "2026-04-01" })] };
    expect(checkRepayment(paid, { amount: 1, date: "2026-05-01" })?.error).toBe("This debt is already fully repaid");
  });

  it("keeps edits consistent with recorded repayments", () => {
    const d = debt({ date: "2026-03-01", amount: 1000, currency: "UAH", repayments: [repayment({ date: "2026-04-01", amount: 600 })] });
    expect(checkDebtUpdate(d, { amount: 600, date: "2026-03-01", currency: "UAH" })).toBeNull();
    expect(checkDebtUpdate(d, { amount: 599.99, date: "2026-03-01", currency: "UAH" })?.fieldErrors?.amount).toBeDefined();
    expect(checkDebtUpdate(d, { amount: 1000, date: "2026-03-01", currency: "USD" })?.fieldErrors?.currency).toBeDefined();
    expect(checkDebtUpdate(d, { amount: 1000, date: "2026-04-02", currency: "UAH" })?.fieldErrors?.date).toBeDefined();
    expect(checkDebtUpdate(debt({ repayments: [] }), { amount: 5, date: "2026-12-01", currency: "EUR" })).toBeNull();
  });

  it("stored debts reject repayments above the amount, before the debt, or a due date before the debt", () => {
    expect(DebtSchema.safeParse(debt({ amount: 100, repayments: [repayment({ amount: 60 }), repayment({ amount: 41 })] })).success).toBe(false);
    expect(DebtSchema.safeParse(debt({ date: "2026-03-01", repayments: [repayment({ date: "2026-02-01" })] })).success).toBe(false);
    expect(DebtSchema.safeParse(debt({ date: "2026-03-01", dueDate: "2026-02-01" })).success).toBe(false);
    expect(DebtSchema.safeParse(debt({ amount: 100, repayments: [repayment({ amount: 100 })] })).success).toBe(true);
  });

  it("import validation catches duplicate debt and repayment ids", () => {
    const main = account({ id: "main", group: "active", currency: "UAH" });
    const s = {
      accounts: [main],
      incomes: [],
      expenses: [],
      categories: [{ id: "t", name: "Taxes", color: "red", systemKey: "taxes", archived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }],
      transfers: [],
      adjustments: [],
      investmentFlows: [],
      valuations: [],
      debts: [debt({ id: "d1", repayments: [repayment({ id: "r" })] }), debt({ id: "d1", repayments: [repayment({ id: "r" })] })],
      settings: { tax: {} as DataSnapshot["settings"]["tax"], defaultActiveAccountId: "main", createdAt: "x", updatedAt: "x" },
    } as DataSnapshot;
    const problems = checkSnapshotIntegrity(s);
    expect(problems).toContain("debts: duplicate id d1");
    expect(problems).toContain("debt repayments: duplicate id r");
  });
});

describe("repayments linked to an account", () => {
  const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH", openingBalance: 0 });
  const base = { accounts: [main], incomes: [], expenses: [], transfers: [], adjustments: [] };

  it("move the account (received +, paid −; accountAmount when currencies differ) and show in recent transactions", () => {
    const debtsList = [
      debt({ direction: "lent", counterparty: "Oleh", amount: 1000, repayments: [repayment({ id: "r1", date: "2026-02-01", amount: 400, accountId: "main" }), repayment({ id: "r2", amount: 100 })] }),
      debt({ direction: "borrowed", counterparty: "Kasia", currency: "PLN", amount: 300, repayments: [repayment({ id: "r3", date: "2026-02-02", amount: 50, accountId: "main", accountAmount: 577 })] }),
    ];
    expect(computeBalances({ ...base, debts: debtsList })).toEqual({ main: 400 - 577 });
    expect(accountUsage("main", { ...base, debts: debtsList })).toMatchObject({ debts: 2, total: 2 });
    const rows = buildTransactions({ ...base, categories: [], debts: debtsList });
    expect(rows.map((r) => [r.type, r.title, r.direction, r.amount, r.currency])).toEqual([
      ["repayment", "Repaid to Kasia", "out", 577, "UAH"],
      ["repayment", "Oleh repaid", "in", 400, "UAH"],
    ]);
  });
});
