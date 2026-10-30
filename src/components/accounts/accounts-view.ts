/**
 * Pure view-model helpers for the Accounts page (no React, no server imports — unit-tested).
 */
import { formatDate, formatDayMonth } from "@/lib/dates";
import type { AccountBalance, BalanceSheet, GroupBalance } from "@/lib/ledger";
import { CURRENCY_SYMBOL, effectiveRate, formatRate } from "@/lib/money";
import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type Account, type AccountGroup, type Currency } from "@/lib/types";
import type { AccountUsage, AccountsPageData } from "@/server/queries";

/** URL search param of the Accounts page: `?archived=1` shows archived accounts. */
export const ARCHIVED_PARAM = "archived";

// ------------------------------------------------------------------ account groups

export interface AccountRowView {
  account: Account;
  usage: AccountUsage;
  /** Native balance (account currency), all movements. */
  balance: number;
  isDefault: boolean;
  /** UAH equivalent at today's NBU rate (balance itself for UAH); null when no rate is known. */
  balanceUah: number | null;
  /** Rate used (1 for UAH; null when unknown). */
  rate: number | null;
  rateDate: string | null;
  /** The rate is the latest cached one, not today's. */
  stale: boolean;
  /** Counted in the totals (non-archived, or archived with a non-zero balance). */
  included: boolean;
}

export interface GroupSectionView {
  group: AccountGroup;
  label: string;
  /** Part of the Frozen balance (every group except "active"). */
  frozen: boolean;
  /** Σ UAH equivalents of the group's included accounts (from the balance sheet). */
  totalUah: number;
  /** Some included account has no rate, so `totalUah` leaves it out. */
  incomplete: boolean;
  stale: boolean;
  /** Rows to render: non-archived first, then archived (only when shown); each in name order. */
  rows: AccountRowView[];
  /** Non-archived accounts in the group. */
  openCount: number;
  /** Archived accounts in the group (shown or not). */
  archivedCount: number;
  /** Archived accounts that are hidden (toggle off) but still counted in `totalUah` (non-zero balance). */
  hiddenCountedCount: number;
}

type GroupsInput = Pick<AccountsPageData, "accounts" | "balances">;

function groupBalances(sheet: BalanceSheet): Map<AccountGroup, GroupBalance> {
  const map = new Map<AccountGroup, GroupBalance>();
  map.set("active", sheet.active);
  for (const g of sheet.frozenGroups) map.set(g.group, g);
  return map;
}

/**
 * The five group sections (Active, Freelancer, Investments, Deposits, Other — always all five, in that order).
 * Archived accounts are left out unless `showArchived`; totals always come from the balance sheet, so an
 * archived account with money on it keeps counting even while hidden (`hiddenCountedCount`).
 */
export function buildGroupSections(data: GroupsInput, showArchived: boolean): GroupSectionView[] {
  const sheetRows = new Map<string, AccountBalance>(data.balances.accounts.map((r) => [r.account.id, r]));
  const totals = groupBalances(data.balances);

  return ACCOUNT_GROUPS.map((group) => {
    const all: AccountRowView[] = data.accounts
      .filter((a) => a.account.group === group)
      .map(({ account, usage, balance, isDefault }) => {
        const r = sheetRows.get(account.id);
        const isUah = account.currency === "UAH";
        return {
          account,
          usage,
          balance,
          isDefault,
          balanceUah: r ? r.balanceUah : isUah ? balance : null,
          rate: r ? r.rate : isUah ? 1 : null,
          rateDate: r?.rateDate ?? null,
          stale: r?.stale ?? false,
          included: r?.included ?? !account.archived,
        };
      });
    const open = all.filter((r) => !r.account.archived);
    const archived = all.filter((r) => r.account.archived);
    const g = totals.get(group);
    return {
      group,
      label: ACCOUNT_GROUP_LABELS[group],
      frozen: group !== "active",
      totalUah: g?.totalUah ?? 0,
      incomplete: g?.incomplete ?? false,
      stale: g?.stale ?? false,
      rows: showArchived ? [...open, ...archived] : open,
      openCount: open.length,
      archivedCount: archived.length,
      hiddenCountedCount: showArchived ? 0 : archived.filter((r) => r.included && r.balance !== 0).length,
    };
  });
}

/** Options for the shared dialogs (Transfer / Update balance), derived from the page's own snapshot. */
export interface AccountsDialogOptions {
  today: string;
  /** Non-archived accounts, sorted by group then name (as the loader sorts them). */
  accounts: Account[];
  /** Current balance (account currency) per account id, all movements. */
  balances: Record<string, number>;
}

export function dialogOptions(data: Pick<AccountsPageData, "today" | "accounts">): AccountsDialogOptions {
  const balances: Record<string, number> = {};
  for (const a of data.accounts) balances[a.account.id] = a.balance;
  return {
    today: data.today,
    accounts: data.accounts.filter((a) => !a.account.archived).map((a) => a.account),
    balances,
  };
}

// ------------------------------------------------------------------ dates

/** Compact date for dense rows: "10 Oct" in the current year, "10 Oct 2025" otherwise. */
export function shortDate(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? formatDayMonth(date) : formatDate(date);
}

// ------------------------------------------------------------------ usage / delete guard

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 incomes · 1 spending · 2 transfers" — or "No records yet". */
export function usageSummary(usage: AccountUsage): string {
  if (usage.total === 0) return "No records yet";
  const parts: string[] = [];
  if (usage.incomes) parts.push(plural(usage.incomes, "income", "incomes"));
  if (usage.expenses) parts.push(plural(usage.expenses, "spending", "spendings"));
  if (usage.transfers) parts.push(plural(usage.transfers, "transfer", "transfers"));
  if (usage.adjustments) parts.push(plural(usage.adjustments, "balance update", "balance updates"));
  if (usage.investments) parts.push(plural(usage.investments, "investment record", "investment records"));
  if (usage.debts) parts.push(plural(usage.debts, "debt repayment", "debt repayments"));
  return parts.join(" · ");
}

/** "12 records" / "1 record". */
export function recordCount(n: number): string {
  return plural(n, "record", "records");
}

export type DeleteBlock = { reason: "default" } | { reason: "used"; usage: AccountUsage };

/** Mirrors `canDeleteAccount` (src/lib/integrity): the main account and referenced accounts can't be deleted. */
export function deleteBlock(row: { isDefault: boolean; usage: AccountUsage }): DeleteBlock | null {
  if (row.isDefault) return { reason: "default" };
  if (row.usage.total > 0) return { reason: "used", usage: row.usage };
  return null;
}

// ------------------------------------------------------------------ transfers

export interface TransferQuote {
  /** 1 unit of `base` … */
  base: Currency;
  /** … = `rate` units of `quote`. */
  quote: Currency;
  rate: number;
  /** sale = foreign → UAH, purchase = UAH → foreign, exchange = foreign ↔ foreign. */
  kind: "sale" | "purchase" | "exchange";
}

/**
 * Effective rate of a cross-currency transfer, oriented the way people read it (same as TransferDialog):
 * UAH per foreign unit when one side is UAH (sale: to/from, purchase: from/to), else to-currency per
 * from-currency unit. Null for same-currency transfers or non-positive amounts.
 */
export function transferQuote(fromCurrency: Currency, toCurrency: Currency, fromAmount: number, toAmount: number): TransferQuote | null {
  if (fromCurrency === toCurrency || !(fromAmount > 0) || !(toAmount > 0)) return null;
  if (toCurrency === "UAH") return { base: fromCurrency, quote: "UAH", rate: effectiveRate(fromAmount, toAmount), kind: "sale" };
  if (fromCurrency === "UAH") return { base: toCurrency, quote: "UAH", rate: effectiveRate(toAmount, fromAmount), kind: "purchase" };
  return { base: fromCurrency, quote: toCurrency, rate: effectiveRate(fromAmount, toAmount), kind: "exchange" };
}

/** "1 $ = 41,2000 ₴" (uses U+00A0 inside the number groups only, as formatRate does). */
export function formatQuote(q: Pick<TransferQuote, "base" | "quote" | "rate">): string {
  return `1 ${CURRENCY_SYMBOL[q.base]} = ${formatRate(q.rate)} ${CURRENCY_SYMBOL[q.quote]}`;
}
