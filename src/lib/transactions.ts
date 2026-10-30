/**
 * Unified, display-ready list of all money movements (incomes, expenses, transfers, adjustments, and
 * debt repayments linked to an account) — for "Recent transactions". Debts themselves are a separate
 * tracker and are not included. Pure + isomorphic.
 */
import { repaymentTitle } from "./debts";
import { INCOME_KIND_LABELS } from "./labels";
import type { Account, Adjustment, Category, Currency, Debt, Expense, Income, IncomeKind, Transfer } from "./types";

export type TransactionType = "income" | "expense" | "transfer" | "adjustment" | "repayment";

export interface TransactionRow {
  /** Unique across types: `${type}:${id}`. Use as React key. */
  key: string;
  type: TransactionType;
  id: string;
  date: string;
  createdAt: string;
  /** Main line: category name, "Salary"/"Freelance" (or counterparty), "Transfer", "Balance update", "Oleh repaid". */
  title: string;
  /** Secondary line: note, or "From → To" for transfers. */
  subtitle?: string;
  /** Always positive; see `direction`. For transfers: fromAmount in the source currency. */
  amount: number;
  currency: Currency;
  /** UAH value when known without a live rate (incomes/expenses); null for transfers/adjustments in FX. */
  amountUah: number | null;
  /**
   * in = money in (income, positive adjustment, a repayment you received); out = spending / negative
   * adjustment / a repayment you made; neutral = transfer.
   */
  direction: "in" | "out" | "neutral";
  accountId: string;
  accountName: string;
  /** Transfers only. */
  toAccountId?: string;
  toAccountName?: string;
  toAmount?: number;
  toCurrency?: Currency;
  /** Expenses only. */
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  categoryIcon?: string;
  /** Incomes only. */
  incomeKind?: IncomeKind;
  /** Expenses recorded as tax payments. */
  isTaxPayment?: boolean;
}

export interface TransactionsData {
  accounts: readonly Account[];
  categories: readonly Category[];
  incomes: readonly Income[];
  expenses: readonly Expense[];
  transfers: readonly Transfer[];
  adjustments: readonly Adjustment[];
  /** Only repayments linked to an account are movements. */
  debts?: readonly Debt[];
}

export function buildTransactions(data: TransactionsData): TransactionRow[] {
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const accName = (id: string) => accounts.get(id)?.name ?? "Unknown account";
  const accCur = (id: string): Currency => accounts.get(id)?.currency ?? "UAH";
  const rows: TransactionRow[] = [];

  for (const i of data.incomes) {
    rows.push({
      key: `income:${i.id}`,
      type: "income",
      id: i.id,
      date: i.date,
      createdAt: i.createdAt,
      title: i.counterparty ? `${INCOME_KIND_LABELS[i.kind]} · ${i.counterparty}` : INCOME_KIND_LABELS[i.kind],
      subtitle: i.note,
      amount: i.amount,
      currency: i.currency,
      amountUah: i.amountUah,
      direction: "in",
      accountId: i.accountId,
      accountName: accName(i.accountId),
      incomeKind: i.kind,
    });
  }
  for (const e of data.expenses) {
    const c = categories.get(e.categoryId);
    rows.push({
      key: `expense:${e.id}`,
      type: "expense",
      id: e.id,
      date: e.date,
      createdAt: e.createdAt,
      title: c?.name ?? "Unknown category",
      subtitle: e.note,
      amount: e.amount,
      currency: e.currency,
      amountUah: e.amountUah,
      direction: "out",
      accountId: e.accountId,
      accountName: accName(e.accountId),
      categoryId: e.categoryId,
      categoryName: c?.name,
      categoryColor: c?.color,
      categoryIcon: c?.icon,
      isTaxPayment: Boolean(e.taxMeta),
    });
  }
  for (const t of data.transfers) {
    const fromCur = accCur(t.fromAccountId);
    rows.push({
      key: `transfer:${t.id}`,
      type: "transfer",
      id: t.id,
      date: t.date,
      createdAt: t.createdAt,
      title: "Transfer",
      subtitle: t.note ?? `${accName(t.fromAccountId)} → ${accName(t.toAccountId)}`,
      amount: t.fromAmount,
      currency: fromCur,
      amountUah: fromCur === "UAH" ? t.fromAmount : null,
      direction: "neutral",
      accountId: t.fromAccountId,
      accountName: accName(t.fromAccountId),
      toAccountId: t.toAccountId,
      toAccountName: accName(t.toAccountId),
      toAmount: t.toAmount,
      toCurrency: accCur(t.toAccountId),
    });
  }
  for (const a of data.adjustments) {
    const cur = accCur(a.accountId);
    rows.push({
      key: `adjustment:${a.id}`,
      type: "adjustment",
      id: a.id,
      date: a.date,
      createdAt: a.createdAt,
      title: "Balance update",
      subtitle: a.note,
      amount: Math.abs(a.delta),
      currency: cur,
      amountUah: cur === "UAH" ? Math.abs(a.delta) : null,
      direction: a.delta >= 0 ? "in" : "out",
      accountId: a.accountId,
      accountName: accName(a.accountId),
    });
  }
  for (const d of data.debts ?? []) {
    for (const r of d.repayments) {
      if (!r.accountId) continue;
      const cur = accCur(r.accountId);
      const amount = r.accountAmount ?? r.amount;
      rows.push({
        key: `repayment:${r.id}`,
        type: "repayment",
        id: r.id,
        date: r.date,
        createdAt: r.createdAt,
        title: repaymentTitle(d),
        subtitle: r.note,
        amount,
        currency: cur,
        amountUah: cur === "UAH" ? amount : null,
        direction: d.direction === "lent" ? "in" : "out",
        accountId: r.accountId,
        accountName: accName(r.accountId),
      });
    }
  }
  return rows.sort(compareTransactions);
}

/** Newest first: date desc, then createdAt desc. */
export function compareTransactions(a: { date: string; createdAt: string }, b: { date: string; createdAt: string }): number {
  return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
}

export function recentTransactions(data: TransactionsData, limit = 10): TransactionRow[] {
  return buildTransactions(data).slice(0, limit);
}
