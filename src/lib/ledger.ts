/**
 * Account balances, Active / Frozen balances and net worth (SPEC §2).
 * balance = openingBalance + Σ incomes→acc (amount − fee) − Σ expenses(acc).amount
 *         + Σ transfers→acc.toAmount − Σ transfers acc→.fromAmount + Σ adjustments(acc).delta
 *         + Σ investment flows (deposit +, withdrawal −)
 *         + Σ debt repayments linked to the account (received +, paid −; debts themselves never count)
 * Valuations (investment "Update value") are ABSOLUTE: the latest one dated ≤ asOf replaces everything
 * before it; movements dated after it — or on the same day but entered after it — are added on top.
 * Debts are a separate tracker (src/lib/debts.ts) and never enter balances or net worth.
 * All arithmetic in integer minor units. Pure + isomorphic.
 */
import { repaymentAccountMovements, repaymentUsageOfAccount } from "./debts";
import { ACCOUNT_GROUP_LABELS, FROZEN_GROUPS } from "./types";
import type {
  Account,
  AccountGroup,
  Adjustment,
  Currency,
  Debt,
  Expense,
  ForeignCurrency,
  Income,
  InvestmentFlow,
  Transfer,
  Valuation,
} from "./types";
import { convertMinorToUah, fromMinor, toMinor } from "./money";

export interface LedgerData {
  accounts: readonly Account[];
  incomes: readonly Income[];
  expenses: readonly Expense[];
  transfers: readonly Transfer[];
  adjustments: readonly Adjustment[];
  /** Optional so callers without investments (older tests, partial data) keep working; a snapshot always has them. */
  investmentFlows?: readonly InvestmentFlow[];
  valuations?: readonly Valuation[];
  /** Only repayments linked to an account move a balance. */
  debts?: readonly Debt[];
}

export interface BalanceOptions {
  /** Only count movements dated ≤ asOf (inclusive). Default: everything. */
  asOf?: string;
}

/** The latest valuation per account dated ≤ asOf (ties on the same date: the one entered last). */
export function latestValuations(valuations: readonly Valuation[], asOf?: string): Map<string, Valuation> {
  const out = new Map<string, Valuation>();
  for (const v of valuations) {
    if (asOf !== undefined && v.date > asOf) continue;
    const cur = out.get(v.accountId);
    if (!cur || v.date > cur.date || (v.date === cur.date && v.createdAt > cur.createdAt)) out.set(v.accountId, v);
  }
  return out;
}

/** accountId → balance in MINOR units of the account currency. */
export function accountBalancesMinor(data: LedgerData, options: BalanceOptions = {}): Map<string, number> {
  const { asOf } = options;
  const inRange = (date: string) => asOf === undefined || date <= asOf;
  // A valuation already includes every movement dated before it, and same-day movements entered before
  // it; a same-day movement entered AFTER it (e.g. "updated the value, then deposited") counts on top.
  const valued = latestValuations(data.valuations ?? [], asOf);
  const bal = new Map<string, number>();
  for (const a of data.accounts) {
    const v = valued.get(a.id);
    bal.set(a.id, v ? toMinor(v.value) : toMinor(a.openingBalance));
  }
  const add = (id: string, date: string, createdAt: string, minor: number) => {
    if (!bal.has(id) || !inRange(date)) return;
    const v = valued.get(id);
    if (v && (date < v.date || (date === v.date && createdAt <= v.createdAt))) return;
    bal.set(id, (bal.get(id) ?? 0) + minor);
  };
  for (const i of data.incomes) add(i.accountId, i.date, i.createdAt, toMinor(i.amount) - toMinor(i.fee ?? 0));
  for (const e of data.expenses) add(e.accountId, e.date, e.createdAt, -toMinor(e.amount));
  for (const t of data.transfers) {
    add(t.fromAccountId, t.date, t.createdAt, -toMinor(t.fromAmount));
    add(t.toAccountId, t.date, t.createdAt, toMinor(t.toAmount));
  }
  for (const adj of data.adjustments) add(adj.accountId, adj.date, adj.createdAt, toMinor(adj.delta));
  for (const f of data.investmentFlows ?? []) add(f.accountId, f.date, f.createdAt, (f.kind === "deposit" ? 1 : -1) * toMinor(f.amount));
  for (const m of repaymentAccountMovements(data.debts ?? [])) add(m.accountId, m.date, m.createdAt, m.minor);
  return bal;
}

/** Balance of one account (major units, account currency). 0 for unknown ids. */
export function accountBalance(accountId: string, data: LedgerData, options: BalanceOptions = {}): number {
  return fromMinor(accountBalancesMinor(data, options).get(accountId) ?? 0);
}

/** accountId → balance (major units). */
export function computeBalances(data: LedgerData, options: BalanceOptions = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, minor] of accountBalancesMinor(data, options)) out[id] = fromMinor(minor);
  return out;
}

/** Today's NBU rate per foreign currency (null/missing → unknown). */
export interface FxRate {
  rate: number;
  /** Date the rate is for (may be older than today when stale). */
  date: string;
  stale: boolean;
}
export type FxRates = Partial<Record<ForeignCurrency, FxRate | null>>;

export interface AccountBalance {
  account: Account;
  /** Native balance in account currency. */
  balance: number;
  currency: Currency;
  /** UAH equivalent at today's NBU rate; null when no rate is known. */
  balanceUah: number | null;
  /** Rate used (1 for UAH; null when unknown). */
  rate: number | null;
  rateDate: string | null;
  /** The rate used is not today's (fallback to the latest cached). */
  stale: boolean;
  /** Counted in totals: non-archived, or archived with a non-zero balance. */
  included: boolean;
}

export interface GroupBalance {
  group: AccountGroup;
  label: string;
  /** Σ UAH equivalents of included accounts with a known rate. */
  totalUah: number;
  accounts: AccountBalance[];
  /** Some included account has no rate → totalUah excludes it. */
  incomplete: boolean;
  stale: boolean;
}

export interface BalanceSheet {
  /** Every account (archived included), in input order. */
  accounts: AccountBalance[];
  /** Group "active". */
  active: GroupBalance;
  /** Freelancer, Investments, Deposits, Other — always 4 entries in that order. */
  frozenGroups: GroupBalance[];
  activeUah: number;
  frozenUah: number;
  /** Active + Frozen. */
  netWorthUah: number;
  /** Any rate used is stale. */
  stale: boolean;
  /** Foreign currencies that had a non-zero balance but no rate at all (excluded from totals). */
  missingRates: Currency[];
}

/**
 * Build the balance sheet. Non-UAH balances are converted at `fx` (today's NBU rate,
 * falling back to the latest cached — pass `stale: true` then).
 * Deviation note: archived accounts with a non-zero balance are counted in every group
 * (SPEC's Account.archived rule), so money never silently disappears from net worth.
 */
export function balanceSheet(data: LedgerData, fx: FxRates, options: BalanceOptions = {}): BalanceSheet {
  const balances = accountBalancesMinor(data, options);
  const missing = new Set<Currency>();
  const rows: AccountBalance[] = data.accounts.map((account) => {
    const minor = balances.get(account.id) ?? 0;
    const included = !account.archived || minor !== 0;
    if (account.currency === "UAH") {
      return {
        account,
        balance: fromMinor(minor),
        currency: "UAH",
        balanceUah: fromMinor(minor),
        rate: 1,
        rateDate: null,
        stale: false,
        included,
      };
    }
    const r = fx[account.currency];
    if (!r) {
      if (included && minor !== 0) missing.add(account.currency);
      return {
        account,
        balance: fromMinor(minor),
        currency: account.currency,
        balanceUah: minor === 0 ? 0 : null,
        rate: null,
        rateDate: null,
        stale: false,
        included,
      };
    }
    return {
      account,
      balance: fromMinor(minor),
      currency: account.currency,
      balanceUah: fromMinor(convertMinorToUah(minor, r.rate)),
      rate: r.rate,
      rateDate: r.date,
      stale: r.stale,
      included,
    };
  });

  const group = (g: AccountGroup): GroupBalance => {
    const accounts = rows.filter((r) => r.account.group === g);
    let total = 0;
    let incomplete = false;
    let stale = false;
    for (const r of accounts) {
      if (!r.included) continue;
      if (r.balanceUah === null) {
        incomplete = true;
        continue;
      }
      total += toMinor(r.balanceUah);
      if (r.stale && r.balance !== 0) stale = true;
    }
    return { group: g, label: ACCOUNT_GROUP_LABELS[g], totalUah: fromMinor(total), accounts, incomplete, stale };
  };

  const active = group("active");
  const frozenGroups = FROZEN_GROUPS.map(group);
  const frozenMinor = frozenGroups.reduce((s, g) => s + toMinor(g.totalUah), 0);
  const activeMinor = toMinor(active.totalUah);
  return {
    accounts: rows,
    active,
    frozenGroups,
    activeUah: fromMinor(activeMinor),
    frozenUah: fromMinor(frozenMinor),
    netWorthUah: fromMinor(activeMinor + frozenMinor),
    stale: active.stale || frozenGroups.some((g) => g.stale),
    missingRates: [...missing],
  };
}

/** Which collections reference an account (for delete guards / usage counts). */
export function accountUsage(accountId: string, data: LedgerData) {
  const incomes = data.incomes.filter((i) => i.accountId === accountId).length;
  const expenses = data.expenses.filter((e) => e.accountId === accountId).length;
  const transfers = data.transfers.filter((t) => t.fromAccountId === accountId || t.toAccountId === accountId).length;
  const adjustments = data.adjustments.filter((a) => a.accountId === accountId).length;
  /** Investment deposits / withdrawals from outside + value updates. */
  const investments =
    (data.investmentFlows ?? []).filter((f) => f.accountId === accountId).length +
    (data.valuations ?? []).filter((v) => v.accountId === accountId).length;
  /** Debt repayments received into / paid from the account. */
  const debts = repaymentUsageOfAccount(accountId, data.debts ?? []);
  return { incomes, expenses, transfers, adjustments, investments, debts, total: incomes + expenses + transfers + adjustments + investments + debts };
}
