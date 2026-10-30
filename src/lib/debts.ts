/**
 * Debts: money you lent (they owe you) and money you borrowed (you owe them) — a SEPARATE tracker.
 * - Repayments reduce what is outstanding; a debt is settled when nothing is outstanding.
 * - Recording a debt never touches account balances, net worth, income, spending or analytics; UAH
 *   totals here are only for the Debts page and the Overview reminder.
 * - A repayment linked to one of your accounts moves that account: + when they paid you back ("lent"),
 *   − when you paid them back ("borrowed"), by `accountAmount` (account currency) or `amount`.
 * All arithmetic in integer minor units. Pure + isomorphic.
 */
import { diffDays, type ISODate } from "./dates";
import type { FxRates } from "./ledger";
import { convertMinorToUah, fromMinor, toMinor } from "./money";
import type { Currency, Debt, DebtDirection, DebtRepayment } from "./types";

/** "Due soon" = the due date is within this many days from today (inclusive). */
export const DUE_SOON_DAYS = 7;

export type DebtDueState = "settled" | "overdue" | "due-today" | "due-soon" | "upcoming" | "no-due-date";

export interface DebtStatus {
  /** Σ repayments (major units, debt currency). */
  repaid: number;
  /** amount − repaid (major units, debt currency), ≥ 0. */
  outstanding: number;
  settled: boolean;
  /** Date of the repayment that settled the debt (null while outstanding). */
  settledOn: ISODate | null;
  lastRepaymentDate: ISODate | null;
  /** Days from today to the due date (negative when overdue); null without a due date or once settled. */
  daysUntilDue: number | null;
  dueState: DebtDueState;
  /** repaid / amount, 0..1 (for progress bars). */
  progress: number;
}

export interface DebtOptions {
  /** Only count repayments dated ≤ asOf (inclusive). Default: all. */
  asOf?: ISODate;
}

function repaymentsUpTo(debt: Debt, asOf?: ISODate): DebtRepayment[] {
  return asOf === undefined ? debt.repayments : debt.repayments.filter((r) => r.date <= asOf);
}

/** Outstanding of one debt in MINOR units of its currency (0 for debts dated after `asOf`). */
export function outstandingMinor(debt: Debt, options: DebtOptions = {}): number {
  if (options.asOf !== undefined && debt.date > options.asOf) return 0;
  const repaid = repaymentsUpTo(debt, options.asOf).reduce((s, r) => s + toMinor(r.amount), 0);
  return Math.max(0, toMinor(debt.amount) - repaid);
}

export function debtStatus(debt: Debt, today: ISODate, options: DebtOptions = {}): DebtStatus {
  const repayments = [...repaymentsUpTo(debt, options.asOf)].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const amountMinor = toMinor(debt.amount);
  let repaidMinor = 0;
  let settledOn: ISODate | null = null;
  for (const r of repayments) {
    repaidMinor += toMinor(r.amount);
    if (settledOn === null && repaidMinor >= amountMinor) settledOn = r.date;
  }
  const outstanding = Math.max(0, amountMinor - repaidMinor);
  const settled = outstanding === 0;
  const lastRepaymentDate = repayments.at(-1)?.date ?? null;

  let daysUntilDue: number | null = null;
  let dueState: DebtDueState;
  if (settled) dueState = "settled";
  else if (!debt.dueDate) dueState = "no-due-date";
  else {
    daysUntilDue = diffDays(today, debt.dueDate);
    dueState = daysUntilDue < 0 ? "overdue" : daysUntilDue === 0 ? "due-today" : daysUntilDue <= DUE_SOON_DAYS ? "due-soon" : "upcoming";
  }
  return {
    repaid: fromMinor(repaidMinor),
    outstanding: fromMinor(outstanding),
    settled,
    settledOn: settled ? settledOn : null,
    lastRepaymentDate,
    daysUntilDue,
    dueState,
    progress: amountMinor === 0 ? 0 : Math.min(1, repaidMinor / amountMinor),
  };
}

/** Needs attention: overdue, due today or due within DUE_SOON_DAYS. */
export function needsAttention(status: Pick<DebtStatus, "dueState">): boolean {
  return status.dueState === "overdue" || status.dueState === "due-today" || status.dueState === "due-soon";
}

const DUE_RANK: Record<DebtDueState, number> = { overdue: 0, "due-today": 1, "due-soon": 2, upcoming: 3, "no-due-date": 4, settled: 5 };

/**
 * Display order: open debts first — overdue (most overdue first), due today, due soon, upcoming
 * (nearest first), no due date (oldest first); then settled ones (most recently settled first).
 */
export function compareDebts(a: { debt: Debt; status: DebtStatus }, b: { debt: Debt; status: DebtStatus }): number {
  const rank = DUE_RANK[a.status.dueState] - DUE_RANK[b.status.dueState];
  if (rank !== 0) return rank;
  if (a.status.settled) {
    return (b.status.settledOn ?? "").localeCompare(a.status.settledOn ?? "") || b.debt.date.localeCompare(a.debt.date);
  }
  if (a.debt.dueDate && b.debt.dueDate && a.debt.dueDate !== b.debt.dueDate) return a.debt.dueDate.localeCompare(b.debt.dueDate);
  return a.debt.date.localeCompare(b.debt.date) || a.debt.createdAt.localeCompare(b.debt.createdAt);
}

// ------------------------------------------------------------------ totals

export interface DebtSideTotals {
  /** Outstanding per currency (major units); only currencies with something outstanding. */
  byCurrency: Partial<Record<Currency, number>>;
  /** Σ UAH equivalents at `fx` (currencies without a rate are left out → `incomplete`). */
  totalUah: number;
  incomplete: boolean;
  /** A foreign amount was converted at a stale (not today's) rate. */
  stale: boolean;
  /** Open (not settled) debts. */
  count: number;
  /** Distinct people among open debts (case-insensitive). */
  people: number;
  /** Foreign currencies with an outstanding amount but no rate. */
  missingRates: Currency[];
}

/** Outstanding totals of one side (lent or borrowed), converted to UAH at `fx`. */
export function sideTotals(debts: readonly Debt[], direction: DebtDirection, fx: FxRates, options: DebtOptions = {}): DebtSideTotals {
  const minorByCurrency = new Map<Currency, number>();
  const people = new Set<string>();
  let count = 0;
  for (const d of debts) {
    if (d.direction !== direction) continue;
    const minor = outstandingMinor(d, options);
    if (minor === 0) continue;
    count += 1;
    people.add(d.counterparty.trim().toLocaleLowerCase("uk-UA"));
    minorByCurrency.set(d.currency, (minorByCurrency.get(d.currency) ?? 0) + minor);
  }
  let totalMinor = 0;
  let incomplete = false;
  let stale = false;
  const missingRates: Currency[] = [];
  const byCurrency: Partial<Record<Currency, number>> = {};
  for (const [currency, minor] of minorByCurrency) {
    byCurrency[currency] = fromMinor(minor);
    if (currency === "UAH") {
      totalMinor += minor;
      continue;
    }
    const r = fx[currency];
    if (!r) {
      incomplete = true;
      missingRates.push(currency);
      continue;
    }
    totalMinor += convertMinorToUah(minor, r.rate);
    if (r.stale) stale = true;
  }
  return { byCurrency, totalUah: fromMinor(totalMinor), incomplete, stale, count, people: people.size, missingRates };
}

export interface DebtWithStatus {
  debt: Debt;
  status: DebtStatus;
}

export interface DebtsSummary {
  /** They owe you. */
  lent: DebtSideTotals;
  /** You owe them. */
  borrowed: DebtSideTotals;
  /** Open debts that are overdue / due today / due soon, in display order. */
  attention: DebtWithStatus[];
  overdueCount: number;
  /** The open debt with the nearest due date that is not overdue (null when none has a due date). */
  nextDue: DebtWithStatus | null;
  /** Any open debt at all. */
  hasOpen: boolean;
}

export function withStatus(debts: readonly Debt[], today: ISODate): DebtWithStatus[] {
  return debts.map((debt) => ({ debt, status: debtStatus(debt, today) })).sort(compareDebts);
}

export function summarizeDebts(debts: readonly Debt[], fx: FxRates, today: ISODate): DebtsSummary {
  const rows = withStatus(debts, today);
  const open = rows.filter((r) => !r.status.settled);
  return {
    lent: sideTotals(debts, "lent", fx),
    borrowed: sideTotals(debts, "borrowed", fx),
    attention: open.filter((r) => needsAttention(r.status)),
    overdueCount: open.filter((r) => r.status.dueState === "overdue").length,
    nextDue:
      open
        .filter((r) => r.status.dueState === "due-today" || r.status.dueState === "due-soon" || r.status.dueState === "upcoming")
        .sort((a, b) => (a.debt.dueDate ?? "").localeCompare(b.debt.dueDate ?? ""))[0] ?? null,
    hasOpen: open.length > 0,
  };
}

/** Number of open debts that are overdue (for the navigation badge). */
export function overdueDebtCount(debts: readonly Debt[], today: ISODate): number {
  return debts.filter((d) => debtStatus(d, today).dueState === "overdue").length;
}

// ------------------------------------------------------------------ account effects of repayments

export interface RepaymentMovement {
  accountId: string;
  date: ISODate;
  createdAt: string;
  /** Signed change of the account balance, MINOR units of the account currency. */
  minor: number;
}

/** Balance changes of repayments linked to an account (the debts themselves never move a balance). */
export function repaymentAccountMovements(debts: readonly Debt[]): RepaymentMovement[] {
  const out: RepaymentMovement[] = [];
  for (const d of debts) {
    const sign = d.direction === "lent" ? 1 : -1;
    for (const r of d.repayments) {
      if (!r.accountId) continue;
      out.push({ accountId: r.accountId, date: r.date, createdAt: r.createdAt, minor: sign * toMinor(r.accountAmount ?? r.amount) });
    }
  }
  return out;
}

/** How many repayments move money through an account (delete guard / usage counts). */
export function repaymentUsageOfAccount(accountId: string, debts: readonly Debt[]): number {
  let n = 0;
  for (const d of debts) for (const r of d.repayments) if (r.accountId === accountId) n += 1;
  return n;
}

// ------------------------------------------------------------------ labels

/** "Lent to Oleh" / "Borrowed from Oleh". */
export function debtTitle(debt: Pick<Debt, "direction" | "counterparty">): string {
  return debt.direction === "lent" ? `Lent to ${debt.counterparty}` : `Borrowed from ${debt.counterparty}`;
}

/** "Oleh repaid" / "Repaid to Oleh". */
export function repaymentTitle(debt: Pick<Debt, "direction" | "counterparty">): string {
  return debt.direction === "lent" ? `${debt.counterparty} repaid` : `Repaid to ${debt.counterparty}`;
}

/** "Overdue by 3 days" / "Due today" / "Due tomorrow" / "Due in 5 days" / "No due date" / "Settled". */
export function dueLabel(status: Pick<DebtStatus, "dueState" | "daysUntilDue">): string {
  const d = status.daysUntilDue;
  switch (status.dueState) {
    case "settled":
      return "Settled";
    case "no-due-date":
      return "No due date";
    case "overdue":
      return `Overdue by ${-d!} ${-d! === 1 ? "day" : "days"}`;
    case "due-today":
      return "Due today";
    default:
      return d === 1 ? "Due tomorrow" : `Due in ${d} days`;
  }
}
