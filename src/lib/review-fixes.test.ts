/** Regression tests for review findings LEDGER-3 and REACT-7 (pure period / analytics helpers). */
import { describe, expect, it } from "vitest";
import { category, expense } from "@/test/factories";
import { compareTotals, periodTotals } from "./analytics";
import { clipToToday, daysElapsed, previousPeriod } from "./periods";

const TODAY = "2026-10-15";

/** 1 000 UAH spent every day from 1 Sep to 15 Oct 2026. */
function dailySpending() {
  const out = [];
  for (let d = new Date(Date.UTC(2026, 8, 1)); d <= new Date(Date.UTC(2026, 9, 15)); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(expense({ date: d.toISOString().slice(0, 10), amount: 1000 }));
  }
  return { incomes: [], expenses: out, categories: [category()] };
}

describe("LEDGER-3: ranges that run past today", () => {
  it("clipToToday / daysElapsed", () => {
    expect(clipToToday({ from: "2026-10-01", to: "2026-10-31" }, TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(clipToToday({ from: "2026-09-01", to: "2026-09-30" }, TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(clipToToday({ from: "2026-11-01", to: "2026-11-30" }, TODAY)).toBeNull();
    expect(daysElapsed({ from: "2026-10-01", to: "2026-10-31" }, TODAY)).toBe(15);
    expect(daysElapsed({ from: "2026-11-01", to: "2026-11-30" }, TODAY)).toBe(0);
  });
  it("a custom 1–31 Oct averages over the 15 elapsed days and compares with 1–15 Sep", () => {
    const data = dailySpending();
    const range = { from: "2026-10-01", to: "2026-10-31" };
    const current = periodTotals(data, range, { today: TODAY });
    expect(current).toMatchObject({ days: 15, spendingUah: 15000, avgDailySpendUah: 1000 });
    const prev = previousPeriod(clipToToday(range, TODAY)!, "custom");
    expect(prev).toEqual({ from: "2026-09-01", to: "2026-09-15" });
    const c = compareTotals(current, periodTotals(data, prev!));
    expect(c.spendingUah.deltaPct).toBe(0);
    expect(c.avgDailySpendUah.deltaPct).toBe(0);
    // Without `today` the old behaviour (31 days) is kept for callers that want the whole range.
    expect(periodTotals(data, range).days).toBe(31);
  });
});

describe("REACT-7: no previous period before the supported dates", () => {
  it("returns null instead of an invalid range (which crashed Analytics)", () => {
    expect(previousPeriod({ from: "1950-01-01", to: TODAY }, "custom")).toBeNull();
    expect(previousPeriod({ from: "1900-01-01", to: "1900-01-31" }, "custom")).toBeNull();
    expect(previousPeriod({ from: "1900-01-05", to: "1900-01-20" }, "custom")).toBeNull();
    expect(previousPeriod({ from: "2015-01-01", to: TODAY }, "custom")).not.toBeNull();
  });
});
