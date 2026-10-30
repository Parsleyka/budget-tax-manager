/**
 * Pure, isomorphic view-model helpers for the Overview page (no React, no server code).
 * Money stays exact: sums go through minor units; shares are derived floats for display only.
 */
import type { PeriodTotals } from "@/lib/analytics";
import { diffDays, formatDate, formatDayMonth, formatQuarter, yearOf, type ISODate } from "@/lib/dates";
import type { AccountBalance, BalanceSheet } from "@/lib/ledger";
import { apportion, fromMinor, percentUnits, toMinor } from "@/lib/money";
import { DEADLINE_KIND_LABELS, type TaxDeadline } from "@/lib/tax/deadlines";
import type { QuarterPaymentStatus } from "@/lib/tax/engine";
import type { TransactionRow } from "@/lib/transactions";
import type { AccountGroup } from "@/lib/types";

export type FrozenGroup = Exclude<AccountGroup, "active">;

/**
 * Fixed series colour per Frozen group (colour follows the entity, never its rank): the first four
 * validated chart slots, in the group order Freelancer → Investments → Deposits → Other.
 */
export const FROZEN_GROUP_COLORS: Record<FrozenGroup, string> = {
  freelancer: "var(--chart-1)",
  ibkr: "var(--chart-2)",
  deposits: "var(--chart-3)",
  other: "var(--chart-4)",
};

export interface FrozenAccountRow extends AccountBalance {
  /**
   * Share of the positive Frozen total (0..1); null when the balance is ≤ 0, has no UAH value, or its
   * group has a negative account (the group's share is net of it, so an account could look bigger than its group).
   */
  share: number | null;
  /**
   * `share` rounded to 0,1 % so that the accounts of a group add up to exactly the group's `displayShare`
   * (largest remainder); null when `share` is null.
   */
  displayShare: number | null;
}

export interface FrozenGroupRow {
  group: FrozenGroup;
  label: string;
  color: string;
  totalUah: number;
  /** Share of the positive Frozen total (0..1); null when the group total is ≤ 0. */
  share: number | null;
  /**
   * `share` rounded to 0,1 % with the largest-remainder method: the shown group shares add up to exactly
   * the "100,0 %" of the Total row (rounding each alone could show 99,9 % or 100,1 %). null when `share` is null.
   */
  displayShare: number | null;
  /** Included accounts only (non-archived, or archived with a balance), largest UAH value first. */
  accounts: FrozenAccountRow[];
  /** Some account has no rate → excluded from `totalUah`. */
  incomplete: boolean;
  stale: boolean;
}

export interface FrozenSegment {
  group: FrozenGroup;
  label: string;
  color: string;
  totalUah: number;
  /** Exact share (bar width). */
  share: number;
  /** Rounded share for labels (sums to exactly 100,0 % over the segments). */
  displayShare: number;
}

export interface FrozenBreakdown {
  totalUah: number;
  /** Always the 4 Frozen groups in fixed order. */
  groups: FrozenGroupRow[];
  /** Bar segments: groups with a positive total, in fixed group order. Shares sum to 1. */
  segments: FrozenSegment[];
  /** A group or account is negative (not drawn in the bar). */
  hasNegative: boolean;
  accountCount: number;
}

function shareOf(valueMinor: number, totalMinor: number): number | null {
  return valueMinor > 0 && totalMinor > 0 ? valueMinor / totalMinor : null;
}

function compareAccounts(a: AccountBalance, b: AccountBalance): number {
  const av = a.balanceUah === null ? -Infinity : a.balanceUah;
  const bv = b.balanceUah === null ? -Infinity : b.balanceUah;
  return bv - av || a.account.name.localeCompare(b.account.name);
}

/** Frozen balance split by group and account, with shares of the positive total (for the stacked bar). */
export function frozenBreakdown(sheet: BalanceSheet): FrozenBreakdown {
  const positiveTotalMinor = sheet.frozenGroups.reduce((sum, g) => sum + Math.max(0, toMinor(g.totalUah)), 0);
  // Display shares in tenths of a percent (1 000 = 100,0 %): groups first, then each group's units are
  // split among its accounts — so the shown shares add up within a group and over the whole table.
  const units = percentUnits(1);
  const groupUnits = apportion(sheet.frozenGroups.map((g) => Math.max(0, toMinor(g.totalUah))), units);
  let hasNegative = false;
  let accountCount = 0;
  const groups: FrozenGroupRow[] = sheet.frozenGroups.map((g, gi) => {
    const group = g.group as FrozenGroup;
    const groupMinor = toMinor(g.totalUah);
    if (groupMinor < 0) hasNegative = true;
    const included = g.accounts.filter((a) => a.included);
    const groupHasNegative = included.some((a) => a.balance < 0 || (a.balanceUah !== null && a.balanceUah < 0));
    if (groupHasNegative) hasNegative = true;
    const minorOf = (a: AccountBalance) => (a.balanceUah === null ? 0 : Math.max(0, toMinor(a.balanceUah)));
    const accountUnits = groupHasNegative ? null : apportion(included.map(minorOf), groupUnits[gi]);
    const accounts = included
      .map((a, ai): FrozenAccountRow => {
        const share = groupHasNegative || a.balanceUah === null ? null : shareOf(toMinor(a.balanceUah), positiveTotalMinor);
        return { ...a, share, displayShare: share === null || !accountUnits ? null : accountUnits[ai] / units };
      })
      .sort(compareAccounts);
    accountCount += accounts.length;
    const share = shareOf(groupMinor, positiveTotalMinor);
    return {
      group,
      label: g.label,
      color: FROZEN_GROUP_COLORS[group],
      totalUah: g.totalUah,
      share,
      displayShare: share === null ? null : groupUnits[gi] / units,
      accounts,
      incomplete: g.incomplete,
      stale: g.stale,
    };
  });
  const segments: FrozenSegment[] = groups
    .filter((g): g is FrozenGroupRow & { share: number; displayShare: number } => g.share !== null && g.displayShare !== null)
    .map(({ group, label, color, totalUah, share, displayShare }) => ({ group, label, color, totalUah, share, displayShare }));
  return { totalUah: sheet.frozenUah, groups, segments, hasNegative, accountCount };
}

/** The oldest rate date used by a stale conversion (for "rates from 13 Oct"), or null. */
export function oldestStaleRateDate(sheet: BalanceSheet): ISODate | null {
  let oldest: ISODate | null = null;
  for (const a of sheet.accounts) {
    if (!a.included || !a.stale || a.balance === 0 || !a.rateDate) continue;
    if (oldest === null || a.rateDate < oldest) oldest = a.rateDate;
  }
  return oldest;
}

/** Balances exist anywhere (opening balances count) — used to decide whether to greet a fresh install. */
export function hasAnyBalance(sheet: BalanceSheet): boolean {
  return sheet.accounts.some((a) => a.balance !== 0);
}

// ------------------------------------------------------------------ recent transactions

/**
 * Where a recent transaction lives. Incomes and spendings open their page filtered to that day
 * (`?period=custom&from=D&to=D`, the loaders' URL contract); transfers and balance updates live on /accounts.
 */
export function transactionHref(row: Pick<TransactionRow, "type" | "date" | "incomeKind">): string {
  const day = `period=custom&from=${row.date}&to=${row.date}`;
  switch (row.type) {
    case "income":
      return `/income?${day}${row.incomeKind ? `&kind=${row.incomeKind}` : ""}`;
    case "expense":
      return `/expenses?${day}`;
    case "transfer":
      return "/accounts#transfers";
    case "adjustment":
      return "/accounts#balance-updates";
    case "repayment":
      return "/debts?view=all";
  }
}

/** "Today" / "Yesterday" / "Tomorrow" / "12 Oct" / "12 Oct 2025" (relative to the server's Kyiv today). */
export function relativeDayLabel(date: ISODate, today: ISODate): string {
  const ago = diffDays(date, today);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  if (ago === -1) return "Tomorrow";
  return yearOf(date) === yearOf(today) ? formatDayMonth(date) : formatDate(date);
}

// ------------------------------------------------------------------ this month

export interface IncomeSplit {
  salaryUah: number;
  /** Freelance net of fees (what was credited), consistent with `incomeUah`. */
  freelanceUah: number;
  salaryShare: number;
  freelanceShare: number;
}

/** Salary vs freelance (net) split of the month's income; null when there is no positive income. */
export function incomeSplit(totals: Pick<PeriodTotals, "salaryUah" | "freelanceNetUah">): IncomeSplit | null {
  const salary = Math.max(0, toMinor(totals.salaryUah));
  const freelance = Math.max(0, toMinor(totals.freelanceNetUah));
  const total = salary + freelance;
  if (total === 0) return null;
  return {
    salaryUah: fromMinor(salary),
    freelanceUah: fromMinor(freelance),
    salaryShare: salary / total,
    freelanceShare: freelance / total,
  };
}

// ------------------------------------------------------------------ tax deadlines

/** "today" / "tomorrow" / "in 4 days" / "4 days ago". */
export function daysLeftText(daysLeft: number): string {
  if (daysLeft === 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft === -1) return "yesterday";
  return daysLeft > 0 ? `in ${daysLeft} days` : `${-daysLeft} days ago`;
}

/** Split a deadline into its action ("Pay ЄСВ") and the period it is for ("Q3 2026", "Q4 2026 · annual"). */
export function deadlineParts(d: Pick<TaxDeadline, "kind" | "period" | "quarter">): { action: string; period: string } {
  const quarter = formatQuarter(d.period);
  return {
    action: DEADLINE_KIND_LABELS[d.kind],
    period: d.kind === "filing" && d.quarter === 4 ? `${quarter} · annual` : quarter,
  };
}

export interface DeadlineDue {
  /** Still to pay for this deadline (UAH, ≥ 0). */
  outstanding: number;
  /** Everything due for it has been paid (or nothing was due). */
  settled: boolean;
  /** Nothing was due at all (e.g. no income, or ЄСВ covered by the employer). */
  nothingDue: boolean;
}

/**
 * Amount behind a payment deadline, from the Freelancer page's paid-vs-due status
 * (`declarationPaymentStatus`). Filing deadlines and periods without a status → null.
 */
export function deadlineDue(
  d: Pick<TaxDeadline, "kind" | "period">,
  statuses: readonly QuarterPaymentStatus[] | null | undefined,
): DeadlineDue | null {
  if (d.kind === "filing" || !statuses) return null;
  const q = statuses.find((s) => s.period === d.period);
  if (!q) return null;
  const items = d.kind === "esv" ? [q.items.esv] : [q.items.single_tax, q.items.military_levy];
  const outstandingMinor = items.reduce((sum, i) => sum + toMinor(i.outstanding), 0);
  const nothingDue = items.every((i) => i.state === "nothing-due");
  return { outstanding: fromMinor(outstandingMinor), settled: outstandingMinor === 0, nothingDue };
}
