import { describe, expect, it } from "vitest";
import { category, expense, income } from "@/test/factories";
import { compareTotals, dataDateRange, feeUah, periodTotals, receivedUah, spendingByCategory, type AnalyticsData } from "./analytics";

const groceries = category({ id: "g", name: "Groceries", color: "blue" });
const cafe = category({ id: "c", name: "Cafés", color: "orange" });
const taxes = category({ id: "t", name: "Taxes", color: "red", systemKey: "taxes" });

const data: AnalyticsData = {
  categories: [groceries, cafe, taxes],
  incomes: [
    income({ id: "s1", kind: "salary", date: "2026-09-05", amount: 40000 }),
    income({ id: "s2", kind: "salary", date: "2026-10-05", amount: 40000 }),
    // 1000 USD @ 44.9801 = 44 980.10 gross, fee 10 USD → received 990 × 44.9801 = 44 530.30
    income({ id: "f1", kind: "freelance", date: "2026-10-10", currency: "USD", amount: 1000, fee: 10, rate: 44.9801 }),
  ],
  expenses: [
    expense({ id: "e1", date: "2026-10-01", amount: 500, categoryId: "g" }),
    expense({ id: "e2", date: "2026-10-02", amount: 300.5, categoryId: "c" }),
    expense({ id: "e3", date: "2026-10-02", amount: 1200, categoryId: "g" }),
    expense({ id: "e4", date: "2026-10-12", amount: 2249, categoryId: "t", taxMeta: { kind: "single_tax", period: "2026-Q3" } }),
    expense({ id: "e5", date: "2026-09-20", amount: 1000, categoryId: "g" }),
    // USD expense: 10 × 44.9801 = 449.80
    expense({ id: "e6", date: "2026-10-14", amount: 10, currency: "USD", rate: 44.9801, categoryId: "c" }),
  ],
};

const oct = { from: "2026-10-01", to: "2026-10-15" };
const sep = { from: "2026-09-01", to: "2026-09-15" };

describe("received / fee", () => {
  it("splits gross into received + fee exactly", () => {
    const f1 = data.incomes[2];
    expect(f1.amountUah).toBe(44980.1);
    expect(receivedUah(f1)).toBe(44530.3);
    expect(feeUah(f1)).toBe(449.8);
    expect(receivedUah(data.incomes[0])).toBe(40000);
    expect(feeUah(data.incomes[0])).toBe(0);
  });
});

describe("periodTotals", () => {
  it("October MTD", () => {
    const t = periodTotals(data, oct);
    expect(t.days).toBe(15);
    expect(t.salaryUah).toBe(40000);
    expect(t.freelanceUah).toBe(44980.1);
    expect(t.freelanceFeesUah).toBe(449.8);
    expect(t.freelanceNetUah).toBe(44530.3);
    expect(t.incomeUah).toBe(84530.3);
    expect(t.spendingUah).toBe(500 + 300.5 + 1200 + 2249 + 449.8); // 4699.30
    expect(t.taxesUah).toBe(2249);
    expect(t.netUah).toBe(79831);
    expect(t.savingsRate).toBeCloseTo(79831 / 84530.3, 10);
    expect(t.avgDailySpendUah).toBe(313.29); // 4699.30 / 15 = 313.2866…
    expect(t.incomeCount).toBe(2);
    expect(t.expenseCount).toBe(5);
  });
  it("empty period", () => {
    const t = periodTotals(data, { from: "2020-01-01", to: "2020-01-31" });
    expect(t).toMatchObject({ incomeUah: 0, spendingUah: 0, netUah: 0, savingsRate: null, avgDailySpendUah: 0 });
  });
  it("compareTotals deltas vs previous period", () => {
    const cmp = compareTotals(periodTotals(data, oct), periodTotals(data, sep));
    expect(cmp.spendingUah).toMatchObject({ current: 4699.3, previous: 0, delta: 4699.3, deltaPct: null });
    const cmp2 = compareTotals(periodTotals(data, oct), periodTotals(data, { from: "2026-09-01", to: "2026-09-30" }));
    expect(cmp2.spendingUah.previous).toBe(1000);
    expect(cmp2.spendingUah.delta).toBe(3699.3);
    expect(cmp2.spendingUah.deltaPct).toBeCloseTo(3.6993, 10);
    expect(cmp2.salaryUah.delta).toBe(0);
    expect(cmp2.savingsRate.delta).toBeCloseTo((79831 / 84530.3) - 39000 / 40000, 10);
  });
});

describe("breakdowns", () => {
  it("spendingByCategory sorted by total with shares", () => {
    const rows = spendingByCategory(data, oct);
    expect(rows.map((r) => [r.categoryId, r.totalUah, r.count])).toEqual([
      ["t", 2249, 1],
      ["g", 1700, 2],
      ["c", 750.3, 2],
    ]);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 10);
    expect(rows[0]).toMatchObject({ name: "Taxes", color: "red" });
  });
  it("dataDateRange", () => {
    expect(dataDateRange(data)).toEqual({ from: "2026-09-05", to: "2026-10-14" });
    expect(dataDateRange({ incomes: [], expenses: [] })).toBeNull();
  });
});
