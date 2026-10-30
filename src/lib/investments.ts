/**
 * Investments page: investment accounts (group "ibkr" — IBKR and any other brokerage) and bank deposits
 * (group "deposits" — term deposits, savings). For each:
 * - value     = the account balance (valuation-aware ledger, see ledger.ts) — counted in Frozen.
 * - deposited = opening balance + deposits − withdrawals, where deposits / withdrawals are transfers
 *               from / to your own accounts plus InvestmentFlows (outside money, e.g. before tracking).
 * - gain      = value − deposited (market moves, dividends, fees, interest — everything not principal).
 * Gains are shown in the account currency and converted to UAH at today's NBU rate.
 * All arithmetic in integer minor units. Pure + isomorphic.
 */
import { diffDays, type ISODate } from "./dates";
import { accountBalancesMinor, latestValuations, type FxRates, type LedgerData } from "./ledger";
import { convertMinorToUah, fromMinor, toMinor } from "./money";
import type { Account, AccountGroup, Currency, InvestmentFlow, Transfer, Valuation } from "./types";

/** Account groups tracked on the Investments page, in page order. */
export const TRACKED_GROUPS = ["ibkr", "deposits"] as const satisfies readonly AccountGroup[];
export type TrackedGroup = (typeof TRACKED_GROUPS)[number];

export function isTrackedGroup(group: AccountGroup): group is TrackedGroup {
  return (TRACKED_GROUPS as readonly AccountGroup[]).includes(group);
}

/** Investment or bank-deposit account: deposits / withdrawals and value updates are tracked for it. */
export function isInvestmentAccount(a: Pick<Account, "group">): boolean {
  return isTrackedGroup(a.group);
}

/** Wording per tracked group (a deposit has a balance with interest; a brokerage has a market value). */
export const TRACKED_GROUP_COPY: Record<
  TrackedGroup,
  { title: string; description: string; value: string; gain: string; update: string; updates: string }
> = {
  ibkr: {
    title: "Investments",
    description: "IBKR and other brokerages — market value vs what you put in",
    value: "Value",
    gain: "Overall gain",
    update: "Update value",
    updates: "Value updates",
  },
  deposits: {
    title: "Bank deposits",
    description: "Term deposits and savings — balance with interest vs what you put in",
    value: "Balance",
    gain: "Interest earned",
    update: "Update balance",
    updates: "Balance updates",
  },
};

export type InvestmentData = LedgerData & { accounts: readonly Account[] };

/** One deposit or withdrawal of an investment account, newest first in lists. */
export interface InvestmentMovement {
  /** "flow:<id>" or "transfer:<id>". */
  key: string;
  source: "flow" | "transfer";
  /** InvestmentFlow id or Transfer id. */
  id: string;
  kind: "deposit" | "withdrawal";
  date: ISODate;
  createdAt: string;
  /** In the investment account currency. */
  amount: number;
  /** Transfers: your other account and what left / arrived there (its currency). */
  linkedAccount: Account | null;
  linkedAmount: number | null;
  note?: string;
}

export interface InvestmentValuationRow extends Valuation {
  /** value − the balance just before it (null for the first one): how much it moved the account. */
  change: number | null;
}

export interface InvestmentSeriesPoint {
  date: ISODate;
  /** Account value on that date (account currency). */
  value: number;
  /** Net deposited up to that date (account currency). */
  deposited: number;
}

export interface InvestmentSummary {
  account: Account;
  currency: Currency;
  /** Current value (account currency). */
  value: number;
  deposited: number;
  withdrawn: number;
  /** openingBalance + deposited − withdrawn. */
  netDeposited: number;
  /** value − netDeposited. */
  gain: number;
  /** gain / netDeposited; null when nothing is invested. */
  returnPct: number | null;
  lastValuation: Valuation | null;
  /** Days since the last value update (null when never updated). */
  valuationAgeDays: number | null;
  /** Newest first. */
  movements: InvestmentMovement[];
  /** Newest first. */
  valuations: InvestmentValuationRow[];
  /** Value vs deposited over time (oldest first): value updates, later deposits / withdrawals, today. */
  series: InvestmentSeriesPoint[];
}

function movementsOf(account: Account, data: InvestmentData): InvestmentMovement[] {
  const byId = new Map(data.accounts.map((a) => [a.id, a]));
  const out: InvestmentMovement[] = [];
  for (const f of data.investmentFlows ?? []) {
    if (f.accountId !== account.id) continue;
    out.push({ key: `flow:${f.id}`, source: "flow", id: f.id, kind: f.kind, date: f.date, createdAt: f.createdAt, amount: f.amount, linkedAccount: null, linkedAmount: null, note: f.note });
  }
  for (const t of data.transfers) {
    if (t.toAccountId === account.id) {
      out.push(transferMovement(t, "deposit", t.toAmount, byId.get(t.fromAccountId) ?? null, t.fromAmount));
    } else if (t.fromAccountId === account.id) {
      out.push(transferMovement(t, "withdrawal", t.fromAmount, byId.get(t.toAccountId) ?? null, t.toAmount));
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function transferMovement(
  t: Transfer,
  kind: "deposit" | "withdrawal",
  amount: number,
  linked: Account | null,
  linkedAmount: number,
): InvestmentMovement {
  return { key: `transfer:${t.id}`, source: "transfer", id: t.id, kind, date: t.date, createdAt: t.createdAt, amount, linkedAccount: linked, linkedAmount, note: t.note };
}

/** Net deposited (minor) of `account` up to and including `asOf` (everything when omitted). */
function netDepositedMinor(account: Account, movements: readonly InvestmentMovement[], asOf?: ISODate): number {
  let minor = toMinor(account.openingBalance);
  for (const m of movements) {
    if (asOf !== undefined && m.date > asOf) continue;
    minor += (m.kind === "deposit" ? 1 : -1) * toMinor(m.amount);
  }
  return minor;
}

export function investmentSummary(account: Account, data: InvestmentData, today: ISODate): InvestmentSummary {
  const movements = movementsOf(account, data);
  const valueMinor = accountBalancesMinor(data, { asOf: today }).get(account.id) ?? 0;
  let depositedMinor = 0;
  let withdrawnMinor = 0;
  for (const m of movements) {
    if (m.date > today) continue;
    if (m.kind === "deposit") depositedMinor += toMinor(m.amount);
    else withdrawnMinor += toMinor(m.amount);
  }
  const netMinor = netDepositedMinor(account, movements, today);
  const gainMinor = valueMinor - netMinor;

  const own = (data.valuations ?? []).filter((v) => v.accountId === account.id && v.date <= today);
  const ascending = [...own].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const valuations: InvestmentValuationRow[] = ascending.map((v, i) => {
    if (i === 0) return { ...v, change: null };
    // The balance just before this update: everything up to the previous day (or the same day, earlier entries).
    const before = accountBalancesMinor(
      { ...data, valuations: ascending.slice(0, i) },
      { asOf: v.date },
    ).get(account.id) ?? 0;
    return { ...v, change: fromMinor(toMinor(v.value) - before) };
  });
  const lastValuation = latestValuations(own, today).get(account.id) ?? null;

  // Points: every value update, every deposit / withdrawal from the first value update on (so the
  // principal steps on the right day), and today. Before the first update the gain is unknown.
  const series: InvestmentSeriesPoint[] = [];
  const firstValued = ascending[0]?.date;
  const dates = [
    ...new Set([
      ...ascending.map((v) => v.date),
      ...(firstValued ? movements.filter((m) => m.date >= firstValued && m.date <= today).map((m) => m.date) : []),
    ]),
  ].sort();
  if (dates.at(-1) !== today && (dates.length > 0 || movements.length > 0)) dates.push(today);
  for (const d of dates) {
    const value = accountBalancesMinor(data, { asOf: d }).get(account.id) ?? 0;
    series.push({ date: d, value: fromMinor(value), deposited: fromMinor(netDepositedMinor(account, movements, d)) });
  }

  return {
    account,
    currency: account.currency,
    value: fromMinor(valueMinor),
    deposited: fromMinor(depositedMinor),
    withdrawn: fromMinor(withdrawnMinor),
    netDeposited: fromMinor(netMinor),
    gain: fromMinor(gainMinor),
    returnPct: netMinor > 0 ? gainMinor / netMinor : null,
    lastValuation,
    valuationAgeDays: lastValuation ? diffDays(lastValuation.date, today) : null,
    movements: movements.filter((m) => m.date <= today),
    valuations: [...valuations].reverse(),
    series,
  };
}

export interface InvestmentTotals {
  /** Σ in UAH at today's NBU rates (accounts without a rate are left out → `incomplete`). */
  valueUah: number;
  netDepositedUah: number;
  gainUah: number;
  /** gainUah / netDepositedUah; null when nothing is invested. */
  returnPct: number | null;
  incomplete: boolean;
  stale: boolean;
  missingRates: Currency[];
}

function toUahMinor(amount: number, currency: Currency, fx: FxRates): number | null {
  if (currency === "UAH") return toMinor(amount);
  const r = fx[currency];
  return r ? convertMinorToUah(toMinor(amount), r.rate) : null;
}

/** Totals of all investment accounts in UAH at today's rates. */
export function investmentTotals(summaries: readonly InvestmentSummary[], fx: FxRates): InvestmentTotals {
  let value = 0;
  let net = 0;
  let incomplete = false;
  let stale = false;
  const missing = new Set<Currency>();
  for (const s of summaries) {
    const v = toUahMinor(s.value, s.currency, fx);
    const n = toUahMinor(s.netDeposited, s.currency, fx);
    if (v === null || n === null) {
      if (s.value !== 0 || s.netDeposited !== 0) {
        incomplete = true;
        missing.add(s.currency);
      }
      continue;
    }
    value += v;
    net += n;
    if (s.currency !== "UAH" && fx[s.currency]?.stale && (s.value !== 0 || s.netDeposited !== 0)) stale = true;
  }
  return {
    valueUah: fromMinor(value),
    netDepositedUah: fromMinor(net),
    gainUah: fromMinor(value - net),
    returnPct: net > 0 ? (value - net) / net : null,
    incomplete,
    stale,
    missingRates: [...missing],
  };
}

/** "today" / "1 day ago" / "12 days ago". */
export function ageLabel(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** InvestmentFlow → the deposit / withdrawal sign (+1 / −1). */
export function flowSign(f: Pick<InvestmentFlow, "kind">): 1 | -1 {
  return f.kind === "deposit" ? 1 : -1;
}
