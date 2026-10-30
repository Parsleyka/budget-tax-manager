/**
 * Pure view-model helpers for the Freelancer page (/freelance). No React, no server code —
 * unit-tested in ./model.test.ts. Money math goes through @/lib/money (integer minor units).
 */
import {
  formatDate,
  formatMonth,
  isValidMonth,
  makeMonth,
  monthEnd,
  monthName,
  monthNumber,
  monthOf,
  monthStart,
  parseQuarterKey,
  quarterKeyOf,
  yearOf,
  type ISODate,
  type ISOMonth,
  type QuarterKey,
} from "@/lib/dates";
import { formatPercent, fromMinor, toMinor } from "@/lib/money";
import type { TaxDeadline } from "@/lib/tax/deadlines";
import type { PaymentStatusItem, QuarterPaymentStatus } from "@/lib/tax/engine";
import { militaryLevyRateBp, MILITARY_LEVY_START } from "@/lib/tax/rules";
import type { Currency, Income, TaxKind, TaxSettings } from "@/lib/types";

export {
  TAX_KINDS,
  declarationName,
  deadlineOutstanding,
  defaultPaymentPeriod,
  isQuarterEnded,
  overdueItems,
  overdueTotal,
  paymentQuarterOptions,
  paymentQuarterOptionsForYears,
  pickNextDeadline,
  type OverdueItem,
  type PaymentQuarterOption,
} from "@/lib/tax/payments";
import { TAX_KINDS, isQuarterEnded } from "@/lib/tax/payments";

// ------------------------------------------------------------------ month selection ↔ URL

/**
 * Compact `?months=` value for the selected months of `year`: consecutive runs become ranges.
 * ["2026-01","2026-02","2026-03","2026-07"] → "1-3,7". An empty selection → "none".
 * Months of other years and invalid entries are dropped.
 */
export function encodeMonthsParam(months: readonly string[], year: number): string {
  const nums = [...new Set(months.filter((m) => isValidMonth(m) && yearOf(m) === year).map(monthNumber))].sort(
    (a, b) => a - b,
  );
  if (nums.length === 0) return "none";
  const parts: string[] = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `${nums[i]}-${nums[j]}` : String(nums[i]));
    i = j + 1;
  }
  return parts.join(",");
}

/**
 * Inverse of `encodeMonthsParam`. `undefined` (no param) → null = use the loader's default;
 * "none" → [] (explicitly nothing selected); unparseable → null. Invalid tokens are skipped.
 */
export function parseMonthsParam(raw: string | undefined | null, year: number): ISOMonth[] | null {
  if (raw === undefined || raw === null) return null;
  const s = raw.trim().toLowerCase();
  if (s === "none") return [];
  const out = new Set<number>();
  for (const token of s.split(",")) {
    const m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(token.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b > 12 || a > b) continue;
    for (let n = a; n <= b; n++) out.add(n);
  }
  if (out.size === 0) return null;
  return [...out].sort((x, y) => x - y).map((n) => makeMonth(year, n));
}

/** Items dated in one of `months` (YYYY-MM), order preserved. */
export function inMonths<T extends { date: string }>(items: readonly T[], months: readonly string[]): T[] {
  const set = new Set(months);
  return items.filter((i) => set.has(monthOf(i.date)));
}

/**
 * Short name of a month selection within one year: "Q3 2026", "Year 2026", "Oct 2026",
 * "Jan – Oct 2026", "5 months of 2026", "No months".
 */
export function describeSelection(months: readonly string[], year: number): string {
  const nums = [...new Set(months.filter((m) => isValidMonth(m) && yearOf(m) === year).map(monthNumber))].sort((a, b) => a - b);
  if (nums.length === 0) return "No months";
  if (nums.length === 12) return `Year ${year}`;
  const contiguous = nums[nums.length - 1] - nums[0] === nums.length - 1;
  if (contiguous && nums.length === 3 && nums[0] % 3 === 1) return `Q${(nums[0] + 2) / 3} ${year}`;
  if (nums.length === 1) return formatMonth(makeMonth(year, nums[0]));
  if (contiguous) return `${monthName(nums[0])} – ${formatMonth(makeMonth(year, nums[nums.length - 1]))}`;
  return `${nums.length} months of ${year}`;
}

// ------------------------------------------------------------------ before / after exchange

export interface CurrencyTotal {
  currency: Currency;
  count: number;
  /** Σ original amounts (gross, before fees) in `currency`. */
  amount: number;
  /** Σ UAH equivalents at each income's NBU rate. */
  amountUah: number;
  /** Σ fees in `currency`. */
  fee: number;
}

const CURRENCY_ORDER: readonly Currency[] = ["USD", "EUR", "UAH"];

/** Per-currency totals before exchange (USD, EUR, UAH — only those present) and the UAH total after exchange. */
export function currencyTotals(incomes: readonly Pick<Income, "currency" | "amount" | "amountUah" | "fee">[]): {
  byCurrency: CurrencyTotal[];
  totalUah: number;
  count: number;
} {
  const acc = new Map<Currency, { count: number; amount: number; uah: number; fee: number }>();
  let total = 0;
  for (const i of incomes) {
    const a = acc.get(i.currency) ?? { count: 0, amount: 0, uah: 0, fee: 0 };
    a.count += 1;
    a.amount += toMinor(i.amount);
    a.uah += toMinor(i.amountUah);
    a.fee += toMinor(i.fee ?? 0);
    acc.set(i.currency, a);
    total += toMinor(i.amountUah);
  }
  return {
    byCurrency: CURRENCY_ORDER.filter((c) => acc.has(c)).map((c) => {
      const a = acc.get(c)!;
      return { currency: c, count: a.count, amount: fromMinor(a.amount), amountUah: fromMinor(a.uah), fee: fromMinor(a.fee) };
    }),
    totalUah: fromMinor(total),
    count: incomes.length,
  };
}

// ------------------------------------------------------------------ rate labels

/** Basis points → "5%", "5,5%", "1,25%". */
export function formatBp(bp: number): string {
  const digits = bp % 100 === 0 ? 0 : bp % 10 === 0 ? 1 : 2;
  return formatPercent(bp / 10_000, digits);
}

export interface LevySummary {
  /** "1%", "0%", "0–1%", "off". */
  label: string;
  note: string;
}

/** Military levy rate(s) that apply to income received in the selected months. */
export function levySummary(
  months: readonly string[],
  tax: Pick<TaxSettings, "militaryLevyEnabled" | "militaryLevyEndDate" | "militaryLevyRateOverridePct">,
): LevySummary {
  if (!tax.militaryLevyEnabled) return { label: "off", note: "Disabled in Settings" };
  const rates = new Set<number>();
  for (const m of months) {
    rates.add(militaryLevyRateBp(monthStart(m), tax));
    rates.add(militaryLevyRateBp(monthEnd(m), tax));
  }
  const override = tax.militaryLevyRateOverridePct !== null ? " (rate from Settings)" : "";
  const start = formatDate(MILITARY_LEVY_START);
  if (rates.size === 0) {
    const bp = militaryLevyRateBp(MILITARY_LEVY_START, tax);
    return { label: formatBp(bp), note: `of income received from ${start}${override}` };
  }
  const nonZero = [...rates].filter((r) => r > 0);
  if (nonZero.length === 0) {
    const allBeforeStart = months.every((m) => monthEnd(m) < MILITARY_LEVY_START);
    return {
      label: "0%",
      note: allBeforeStart
        ? "group 3 paid no military levy before 2025"
        : `outside the levy period${tax.militaryLevyEndDate ? ` (ended ${formatDate(tax.militaryLevyEndDate)})` : ""}`,
    };
  }
  const max = Math.max(...nonZero);
  if (rates.size === 1) return { label: formatBp(max), note: `of all income${override}` };
  return { label: `0–${formatBp(max)}`, note: `${formatBp(max)} only on income inside the levy period (from ${start})${override}` };
}

/** Search param of the Freelancer page's "Include ЄСВ" switch (`?esv=1`). */
export const ESV_PARAM = "esv";

/** Keep the "Include ЄСВ" switch (`esv=1`) of the current URL when the page rewrites its search params. */
export function esvParamSuffix(search: string): string {
  const v = new URLSearchParams(search).get(ESV_PARAM);
  return v ? `&${ESV_PARAM}=${encodeURIComponent(v)}` : "";
}

// ------------------------------------------------------------------ payment status

export type Tone = "positive" | "warning" | "negative" | "info" | "muted";

export interface StatusView {
  label: string;
  tone: Tone;
}

/** "today", "tomorrow", "in 5 days", "yesterday", "3 days ago". */
export function daysLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 1 ? `in ${days} days` : `${-days} days ago`;
}

/** Paid-vs-due label for one tax kind of one quarter. */
export function itemStatus(item: PaymentStatusItem, quarterEnded: boolean): StatusView {
  switch (item.state) {
    case "nothing-due":
      return { label: "Nothing due", tone: "muted" };
    case "paid":
      // Covered (fully) by an overpayment of an earlier quarter of the year.
      return { label: item.paid === 0 && item.creditApplied > 0 ? "Paid from credit" : "Paid", tone: "positive" };
    case "overpaid":
      // The excess is carried forward to the next quarters (see declarationPaymentStatus).
      return { label: item.carriedForward > 0 ? "Overpaid · carried over" : "Overpaid", tone: "positive" };
    case "partial":
      return item.overdue ? { label: "Overdue · partly paid", tone: "negative" } : { label: "Partly paid", tone: "warning" };
    case "unpaid":
      if (item.overdue) return { label: "Overdue", tone: "negative" };
      if (!quarterEnded) return { label: "Accruing", tone: "info" };
      return { label: item.daysLeft === 0 ? "Due today" : `Due ${daysLabel(item.daysLeft)}`, tone: "warning" };
  }
}

/** Overall paid-vs-due label for a quarter. */
export function quarterStatus(status: QuarterPaymentStatus, today: ISODate): StatusView {
  const items = TAX_KINDS.map((k) => status.items[k]);
  if (!isQuarterEnded(status.period, today)) return { label: "In progress", tone: "info" };
  if (items.some((i) => i.overdue)) return { label: "Overdue", tone: "negative" };
  if (status.outstanding === 0) {
    if (items.every((i) => i.state === "nothing-due")) return { label: "Nothing due", tone: "muted" };
    return { label: "Paid", tone: "positive" };
  }
  if (items.some((i) => i.paid > 0 || i.creditApplied > 0)) return { label: "Partly paid", tone: "warning" };
  const nearest = Math.min(...items.filter((i) => i.outstanding > 0).map((i) => i.daysLeft));
  return { label: nearest === 0 ? "Due today" : `Due ${daysLabel(nearest)}`, tone: "warning" };
}

/** "Q3 2026", "Q1–Q4 2026", "Q1, Q3 2026", "Q4 2025, Q1 2026" (sorted, de-duplicated). */
export function describeQuarters(periods: readonly QuarterKey[]): string {
  const byYear = new Map<number, number[]>();
  for (const p of [...new Set(periods)].sort()) {
    const { year, quarter } = parseQuarterKey(p);
    byYear.set(year, [...(byYear.get(year) ?? []), quarter]);
  }
  return [...byYear.entries()]
    .map(([year, qs]) => {
      const contiguous = qs.length > 1 && qs[qs.length - 1] - qs[0] === qs.length - 1;
      return `${contiguous ? `Q${qs[0]}–Q${qs[qs.length - 1]}` : qs.map((q) => `Q${q}`).join(", ")} ${year}`;
    })
    .join(", ");
}

export interface SelectionPayments {
  /** Quarters touched by the selection that have a paid-vs-due status. */
  periods: QuarterKey[];
  /** "Q1–Q4 2026". */
  label: string;
  /** Σ due of those quarters (declaration amounts — whole quarters, so it can differ from the selection total). */
  due: number;
  /** Σ covered: recorded payments for those quarters plus credit carried in from earlier quarters. */
  paid: number;
  /** Σ still outstanding (an unfinished quarter counts what has accrued so far). */
  outstanding: number;
}

/**
 * Paid vs outstanding for the quarters touched by the selected months, from the declaration statuses —
 * the selection's tax total is an accrual and says nothing about what has been paid (JOURNEY-7).
 * null when no selected quarter has a status (e.g. no months selected).
 */
export function selectionPayments(
  statuses: readonly QuarterPaymentStatus[],
  months: readonly string[],
): SelectionPayments | null {
  const wanted = new Set(months.filter(isValidMonth).map((m) => quarterKeyOf(m)));
  const picked = statuses.filter((s) => wanted.has(s.period)).sort((a, b) => a.period.localeCompare(b.period));
  if (picked.length === 0) return null;
  let due = 0;
  let outstanding = 0;
  for (const s of picked) {
    for (const k of TAX_KINDS) {
      due += toMinor(s.items[k].due);
      outstanding += toMinor(s.items[k].outstanding);
    }
  }
  const periods = picked.map((s) => s.period);
  return {
    periods,
    label: describeQuarters(periods),
    due: fromMinor(due),
    paid: fromMinor(due - outstanding),
    outstanding: fromMinor(outstanding),
  };
}

export function sameDeadline(a: Pick<TaxDeadline, "kind" | "period"> | null, kind: TaxDeadline["kind"], period: QuarterKey): boolean {
  return a !== null && a.kind === kind && a.period === period;
}

export interface PaymentLineInput {
  kind: TaxKind;
  checked: boolean;
  /** Raw input text ("1 234,56"). */
  amount: string;
}

/**
 * Validates the checked payment lines. Returns the lines to submit (in TAX_KINDS order) and
 * per-kind error messages; `formError` when nothing is checked.
 */
export function buildPaymentLines(
  lines: readonly PaymentLineInput[],
  parse: (text: string) => number | null,
): { payments: { kind: TaxKind; amount: number }[]; errors: Partial<Record<TaxKind, string>>; formError: string | null } {
  const payments: { kind: TaxKind; amount: number }[] = [];
  const errors: Partial<Record<TaxKind, string>> = {};
  const ordered = [...lines].sort((a, b) => TAX_KINDS.indexOf(a.kind) - TAX_KINDS.indexOf(b.kind));
  for (const l of ordered) {
    if (!l.checked) continue;
    const amount = parse(l.amount);
    if (amount === null || amount <= 0) errors[l.kind] = "Enter an amount greater than 0 (at most 2 decimals)";
    else payments.push({ kind: l.kind, amount });
  }
  const anyChecked = lines.some((l) => l.checked);
  return { payments, errors, formError: anyChecked ? null : "Choose at least one tax to record" };
}

/**
 * From 01.07.2026 the military levy goes to new budget accounts (budget code 11011700, Law 4908-IX);
 * old payment templates are invalid. Returns the reminder when the payment date falls in that window.
 */
export function levyPaymentNote(date: ISODate): string | null {
  if (date >= "2026-07-01" && date <= "2026-12-31") {
    return "Since 1 Jul 2026 the military levy is paid to new budget accounts (code 11011700) — old payment templates are invalid.";
  }
  return null;
}
