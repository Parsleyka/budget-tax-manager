/**
 * Budget analytics over a date range (inclusive). All amounts are UAH (expenses use their
 * stored `amountUah`; incomes their stored rate). Pure + isomorphic.
 *
 * Income semantics: "income" = money actually received in UAH terms =
 * salary + freelance (amount − fee) converted at the income's rate. Gross freelance (the tax
 * base) and fees are reported separately.
 */
import { daysInclusive, type ISODate } from "./dates";
import { convertToUah, divRoundHalfUp, fromMinor, toMinor } from "./money";
import { daysElapsed, type DateRange } from "./periods";
import type { Category, Expense, Income } from "./types";

export interface AnalyticsData {
  incomes: readonly Income[];
  expenses: readonly Expense[];
  categories: readonly Category[];
}

export function inRange<T extends { date: string }>(items: readonly T[], range: DateRange): T[] {
  return items.filter((i) => i.date >= range.from && i.date <= range.to);
}

/** UAH actually credited for an income: convertToUah(amount − fee, rate). */
export function receivedUah(income: Income): number {
  if (!income.fee) return income.amountUah;
  return convertToUah(fromMinor(toMinor(income.amount) - toMinor(income.fee)), income.rate);
}

/** UAH value of the fee, defined so that received + fee = amountUah exactly. */
export function feeUah(income: Income): number {
  return fromMinor(toMinor(income.amountUah) - toMinor(receivedUah(income)));
}

export interface PeriodTotals {
  range: DateRange;
  /** Days of the range (only those up to `today` when it was passed — the average's divisor). */
  days: number;
  /** Net received: salary + freelance net of fees. */
  incomeUah: number;
  salaryUah: number;
  /** Gross freelance (tax base). */
  freelanceUah: number;
  freelanceFeesUah: number;
  freelanceNetUah: number;
  spendingUah: number;
  /** Part of spending that went to taxes (expenses with taxMeta or in the Taxes category). */
  taxesUah: number;
  /** incomeUah − spendingUah. */
  netUah: number;
  /** netUah / incomeUah (fraction, may be negative); null when there is no income. */
  savingsRate: number | null;
  /** spendingUah / max(days, 1), HALF-UP to kopecks. */
  avgDailySpendUah: number;
  incomeCount: number;
  expenseCount: number;
}

/**
 * Totals of a range. Pass `today` so a range that runs past today (a custom "1–31 Oct" on the 15th,
 * or "All time") averages over the days that have passed, not over future days.
 */
export function periodTotals(data: AnalyticsData, range: DateRange, options: { today?: ISODate } = {}): PeriodTotals {
  const taxCategoryIds = new Set(data.categories.filter((c) => c.systemKey === "taxes").map((c) => c.id));
  let salary = 0;
  let freelance = 0;
  let fees = 0;
  const incomes = inRange(data.incomes, range);
  for (const i of incomes) {
    if (i.kind === "salary") salary += toMinor(i.amountUah);
    else {
      freelance += toMinor(i.amountUah);
      fees += toMinor(feeUah(i));
    }
  }
  let spending = 0;
  let taxes = 0;
  const expenses = inRange(data.expenses, range);
  for (const e of expenses) {
    spending += toMinor(e.amountUah);
    if (e.taxMeta || taxCategoryIds.has(e.categoryId)) taxes += toMinor(e.amountUah);
  }
  const income = salary + freelance - fees;
  const net = income - spending;
  const days = options.today ? daysElapsed(range, options.today) : daysInclusive(range.from, range.to);
  return {
    range,
    days,
    incomeUah: fromMinor(income),
    salaryUah: fromMinor(salary),
    freelanceUah: fromMinor(freelance),
    freelanceFeesUah: fromMinor(fees),
    freelanceNetUah: fromMinor(freelance - fees),
    spendingUah: fromMinor(spending),
    taxesUah: fromMinor(taxes),
    netUah: fromMinor(net),
    savingsRate: income > 0 ? net / income : null,
    avgDailySpendUah: fromMinor(Number(divRoundHalfUp(BigInt(spending), BigInt(Math.max(days, 1))))),
    incomeCount: incomes.length,
    expenseCount: expenses.length,
  };
}

export interface MetricDelta {
  current: number;
  previous: number;
  /** current − previous (money metrics exact to kopecks). */
  delta: number;
  /** delta / |previous|; null when previous is 0. */
  deltaPct: number | null;
}

export interface TotalsComparison {
  incomeUah: MetricDelta;
  salaryUah: MetricDelta;
  freelanceUah: MetricDelta;
  spendingUah: MetricDelta;
  netUah: MetricDelta;
  avgDailySpendUah: MetricDelta;
  /** Savings rate change in percentage POINTS as a fraction (0.05 = +5 pp); null if either side is null. */
  savingsRate: { current: number | null; previous: number | null; delta: number | null };
}

function moneyDelta(current: number, previous: number): MetricDelta {
  const d = fromMinor(toMinor(current) - toMinor(previous));
  return { current, previous, delta: d, deltaPct: previous === 0 ? null : d / Math.abs(previous) };
}

export function compareTotals(current: PeriodTotals, previous: PeriodTotals): TotalsComparison {
  return {
    incomeUah: moneyDelta(current.incomeUah, previous.incomeUah),
    salaryUah: moneyDelta(current.salaryUah, previous.salaryUah),
    freelanceUah: moneyDelta(current.freelanceUah, previous.freelanceUah),
    spendingUah: moneyDelta(current.spendingUah, previous.spendingUah),
    netUah: moneyDelta(current.netUah, previous.netUah),
    avgDailySpendUah: moneyDelta(current.avgDailySpendUah, previous.avgDailySpendUah),
    savingsRate: {
      current: current.savingsRate,
      previous: previous.savingsRate,
      delta:
        current.savingsRate === null || previous.savingsRate === null ? null : current.savingsRate - previous.savingsRate,
    },
  };
}

export interface CategorySpending {
  categoryId: string;
  name: string;
  color: string;
  icon?: string;
  archived: boolean;
  totalUah: number;
  count: number;
  /** Share of the range's total spending (0..1). */
  share: number;
}

/** Spending per category, sorted by total desc (ties by name). Unknown category ids → "Unknown". */
export function spendingByCategory(data: AnalyticsData, range: DateRange): CategorySpending[] {
  const byId = new Map(data.categories.map((c) => [c.id, c]));
  const sums = new Map<string, { minor: number; count: number }>();
  let total = 0;
  for (const e of inRange(data.expenses, range)) {
    const s = sums.get(e.categoryId) ?? { minor: 0, count: 0 };
    s.minor += toMinor(e.amountUah);
    s.count += 1;
    sums.set(e.categoryId, s);
    total += toMinor(e.amountUah);
  }
  const rows: CategorySpending[] = [...sums.entries()].map(([categoryId, s]) => {
    const c = byId.get(categoryId);
    return {
      categoryId,
      name: c?.name ?? "Unknown",
      color: c?.color ?? "gray",
      icon: c?.icon,
      archived: c?.archived ?? false,
      totalUah: fromMinor(s.minor),
      count: s.count,
      share: total === 0 ? 0 : s.minor / total,
    };
  });
  return rows.sort((a, b) => b.totalUah - a.totalUah || a.name.localeCompare(b.name));
}

/** Earliest..latest date across incomes and expenses (for the "all" preset); null when empty. */
export function dataDateRange(data: Pick<AnalyticsData, "incomes" | "expenses">): DateRange | null {
  let from: string | null = null;
  let to: string | null = null;
  for (const x of [...data.incomes, ...data.expenses]) {
    if (from === null || x.date < from) from = x.date;
    if (to === null || x.date > to) to = x.date;
  }
  return from && to ? { from, to } : null;
}
