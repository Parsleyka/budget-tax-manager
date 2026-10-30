/**
 * Pure helpers for the Spendings page: URL params (sort, page size, multi-category filter),
 * sorting, day grouping and the "By category" breakdown. Isomorphic and framework-free, so the
 * Server Component page and the client list share them (and they are unit-tested).
 *
 * All money arithmetic runs in integer minor units through `@/lib/money`.
 */
import type { CategorySpending } from "@/lib/analytics";
import { addDays, formatDate, type ISODate } from "@/lib/dates";
import { fromMinor, roundedShares, toMinor } from "@/lib/money";
import type { DateRange } from "@/lib/periods";
import type { Expense } from "@/lib/types";

type ParamValue = string | string[] | undefined;

// ------------------------------------------------------------------ sort

export const EXPENSE_SORTS = ["date-desc", "date-asc", "amount-desc", "amount-asc"] as const;
export type ExpenseSort = (typeof EXPENSE_SORTS)[number];
export const DEFAULT_SORT: ExpenseSort = "date-desc";

export const EXPENSE_SORT_LABELS: Record<ExpenseSort, string> = {
  "date-desc": "Newest first",
  "date-asc": "Oldest first",
  "amount-desc": "Largest first",
  "amount-asc": "Smallest first",
};

export function isExpenseSort(value: unknown): value is ExpenseSort {
  return typeof value === "string" && (EXPENSE_SORTS as readonly string[]).includes(value);
}

function first(value: ParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `?sort=` → a known sort (default: newest first). */
export function parseSort(value: ParamValue): ExpenseSort {
  const v = first(value);
  return isExpenseSort(v) ? v : DEFAULT_SORT;
}

/** Date sorts are shown grouped by day; amount sorts as a plain table. */
export function isDateSort(sort: ExpenseSort): boolean {
  return sort === "date-desc" || sort === "date-asc";
}

// ------------------------------------------------------------------ "show more"

/** Rows rendered per step of "Show more". */
export const PAGE_SIZE = 50;
/** Upper bound for `?limit=`: the most rows one page renders ("Show all" up to this; narrow the filters for more). Keeps the RSC payload and DOM sane. */
export const MAX_LIMIT = 1000;

/** `?limit=` → number of rows to render: an integer in [PAGE_SIZE, MAX_LIMIT] (default PAGE_SIZE). */
export function parseLimit(value: ParamValue): number {
  const v = first(value);
  if (!v || !/^\d{1,6}$/.test(v)) return PAGE_SIZE;
  return Math.min(MAX_LIMIT, Math.max(PAGE_SIZE, Number(v)));
}

// ------------------------------------------------------------------ category filter (multi)

/**
 * `?category=` → selected category ids. Accepts a comma-separated list and/or repeated params
 * (`?category=a,b` or `?category=a&category=b`). Trims, de-duplicates, keeps first-seen order and,
 * when `known` is given, drops ids that do not exist.
 */
export function parseCategoryIds(value: ParamValue, known?: Iterable<string>): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const knownSet = known ? new Set(known) : null;
  const out: string[] = [];
  for (const part of raw.flatMap((v) => v.split(","))) {
    const id = part.trim();
    if (!id || out.includes(id)) continue;
    if (knownSet && !knownSet.has(id)) continue;
    out.push(id);
  }
  return out;
}

/** Selected ids → the `category` param value (null = remove the param). */
export function serializeCategoryIds(ids: readonly string[]): string | null {
  return ids.length ? ids.join(",") : null;
}

// ------------------------------------------------------------------ URL patching

/** Param changes: a string sets the param, null/undefined/"" removes it. */
export type ParamPatch = Record<string, string | null | undefined>;

/**
 * Apply `patch` to a query string. Unless `keepLimit` is set (or the patch sets `limit` itself),
 * `limit` is dropped so a changed filter starts again from the first page.
 */
export function applyParamPatch(query: string, patch: ParamPatch, options: { keepLimit?: boolean } = {}): string {
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  if (!options.keepLimit && !("limit" in patch)) params.delete("limit");
  return params.toString();
}

// ------------------------------------------------------------------ rows

/** The fields these helpers need (an `ExpenseRow` satisfies it). */
export type ExpenseLike = Pick<Expense, "id" | "date" | "createdAt" | "amount" | "currency" | "amountUah" | "categoryId">;

export function filterByCategories<T extends ExpenseLike>(rows: readonly T[], categoryIds: readonly string[]): T[] {
  if (!categoryIds.length) return [...rows];
  const ids = new Set(categoryIds);
  return rows.filter((r) => ids.has(r.categoryId));
}

const newestFirst = (a: ExpenseLike, b: ExpenseLike) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);

/**
 * Sort a copy of `rows`. Amount sorts compare the UAH equivalent (so 100 $ ranks above 100 ₴);
 * ties fall back to newest first. Date ascending is the exact reverse of newest first.
 */
export function sortExpenseRows<T extends ExpenseLike>(rows: readonly T[], sort: ExpenseSort): T[] {
  const copy = [...rows];
  switch (sort) {
    case "date-asc":
      return copy.sort((a, b) => newestFirst(b, a));
    case "amount-desc":
      return copy.sort((a, b) => toMinor(b.amountUah) - toMinor(a.amountUah) || newestFirst(a, b));
    case "amount-asc":
      return copy.sort((a, b) => toMinor(a.amountUah) - toMinor(b.amountUah) || newestFirst(a, b));
    default:
      return copy.sort(newestFirst);
  }
}

export interface DayTotal {
  totalUah: number;
  count: number;
}

/** UAH total and count per date. */
export function dayTotals(rows: readonly ExpenseLike[]): Record<ISODate, DayTotal> {
  const minor = new Map<ISODate, { sum: number; count: number }>();
  for (const r of rows) {
    const d = minor.get(r.date) ?? { sum: 0, count: 0 };
    d.sum += toMinor(r.amountUah);
    d.count += 1;
    minor.set(r.date, d);
  }
  const out: Record<ISODate, DayTotal> = {};
  for (const [date, d] of minor) out[date] = { totalUah: fromMinor(d.sum), count: d.count };
  return out;
}

/** Keep only the entries for `dates` (to ship just the visible days to the client). */
export function pickDayTotals(totals: Record<ISODate, DayTotal>, dates: Iterable<ISODate>): Record<ISODate, DayTotal> {
  const out: Record<ISODate, DayTotal> = {};
  for (const d of dates) if (totals[d]) out[d] = totals[d];
  return out;
}

export interface DayGroup<T> {
  date: ISODate;
  /** The whole day's total in the filtered set (may include rows not rendered yet). */
  totalUah: number;
  count: number;
  rows: T[];
}

/**
 * Group date-sorted rows into consecutive days, keeping their order. `totals` (from the full filtered
 * set) wins over the visible rows' own sums, so a day cut by "Show more" still shows its full total.
 */
export function groupByDay<T extends ExpenseLike>(rows: readonly T[], totals?: Record<ISODate, DayTotal>): DayGroup<T>[] {
  const own = dayTotals(rows);
  const groups: DayGroup<T>[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === row.date) {
      last.rows.push(row);
      continue;
    }
    const t = totals?.[row.date] ?? own[row.date];
    groups.push({ date: row.date, totalUah: t.totalUah, count: t.count, rows: [row] });
  }
  return groups;
}

// ------------------------------------------------------------------ by-category breakdown

/** Rows of the "By category" list shown before "Show all". */
export const BREAKDOWN_LIMIT = 6;

export interface BreakdownRow extends CategorySpending {
  /** `share` rounded to 0,1 % so the rows add up to exactly 100,0 % (largest remainder). */
  share: number;
  /** Bar length: this total relative to the biggest category (0..1). */
  width: number;
}

/** Categories with spending, biggest first, with display shares and bar widths. */
export function breakdownRows(rows: readonly CategorySpending[]): BreakdownRow[] {
  const spent = rows.filter((r) => toMinor(r.totalUah) > 0);
  const shares = roundedShares(spent.map((r) => r.totalUah));
  const max = Math.max(0, ...spent.map((r) => toMinor(r.totalUah)));
  return spent.map((r, i) => ({ ...r, share: shares[i], width: max === 0 ? 0 : toMinor(r.totalUah) / max }));
}

/** A breakdown row click: show only that category; clicking the sole selected one clears the filter. */
export function soleCategoryToggle(selected: readonly string[], id: string): string[] {
  return selected.length === 1 && selected[0] === id ? [] : [id];
}

// ------------------------------------------------------------------ view context

/** What the list is currently showing (to explain why a just-saved spending is not visible). */
export interface ExpenseViewContext {
  range: DateRange;
  categoryIds: string[];
  accountId: string | null;
}

/** Why `expense` would not appear under the current filters, or null when it is visible. */
export function hiddenReason(
  expense: Pick<Expense, "date" | "categoryId" | "accountId">,
  view: ExpenseViewContext,
): string | null {
  if (expense.date < view.range.from || expense.date > view.range.to) {
    return `It's dated ${formatDate(expense.date)}, outside the selected period.`;
  }
  if (view.categoryIds.length && !view.categoryIds.includes(expense.categoryId)) {
    return "Its category is not in the category filter.";
  }
  if (view.accountId && expense.accountId !== view.accountId) {
    return "It's on a different account than the one filtered.";
  }
  return null;
}

/**
 * Integer with uk-UA style grouping ("12 345", U+00A0). Deterministic — unlike `toLocaleString`, it
 * cannot differ between the server's and the browser's ICU data, so it is hydration-safe.
 */
export function formatCount(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
}

/** "1 spending" / "12 spendings" (with `formatCount`). */
export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "Today" / "Yesterday" / null for a date relative to `today`. */
export function relativeDayLabel(date: ISODate, today: ISODate): string | null {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return null;
}
