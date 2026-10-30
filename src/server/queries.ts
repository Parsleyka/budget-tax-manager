import "server-only";
import { promises as fs } from "node:fs";
import { connection } from "next/server";
import { cache } from "react";
import {
  dataDateRange,
  feeUah,
  periodTotals,
  receivedUah,
  spendingByCategory,
  type CategorySpending,
  type PeriodTotals,
} from "@/lib/analytics";
import { sortCategories } from "@/lib/categories";
import { todayKyiv, yearOf, type ISODate, type ISOMonth } from "@/lib/dates";
import { overdueDebtCount, summarizeDebts, withStatus, type DebtStatus, type DebtsSummary } from "@/lib/debts";
import {
  investmentSummary,
  investmentTotals,
  isInvestmentAccount,
  TRACKED_GROUPS,
  type InvestmentSummary,
  type InvestmentTotals,
  type TrackedGroup,
} from "@/lib/investments";
import { accountUsage, balanceSheet, computeBalances, type BalanceSheet, type FxRates } from "@/lib/ledger";
import { effectiveRate, fromMinor, toMinor } from "@/lib/money";
import { firstParam, parsePeriodParams, resolvePeriod, type DateRange, type PeriodPreset } from "@/lib/periods";
import { deadlinesForYear, upcomingDeadlines, type TaxDeadline } from "@/lib/tax/deadlines";
import {
  declarationPaymentStatus,
  quarterlyDeclaration,
  summarizeTaxPayments,
  yearToDateMonths,
  type QuarterlyDeclaration,
  type QuarterPaymentStatus,
  type TaxPaymentTotals,
} from "@/lib/tax/engine";
import {
  esvApplies,
  esvOptionalAvailable,
  optionalEsvByQuarter,
  overdueItems,
  paymentQuarterOptionsForYears,
  relevantDeadlines,
  withMinimumEsv,
  type OverdueItem,
  type PaymentQuarterOption,
} from "@/lib/tax/payments";
import { FIRST_RULES_YEAR, rulesTable, type RulesTable } from "@/lib/tax/rules";
import { recentTransactions, type TransactionRow } from "@/lib/transactions";
import { ACCOUNT_GROUPS } from "@/lib/types";
import type {
  Account,
  Adjustment,
  Category,
  Currency,
  DataSnapshot,
  Debt,
  DebtRepayment,
  Expense,
  ForeignCurrency,
  Income,
  Settings,
  Transfer,
} from "@/lib/types";
import { getDataDir } from "./config";
import { ALL_DATA_FILES, checkDataHealth, dataFilePath, readCollection, readSnapshot, type DataHealthProblem } from "./db/store";
import { getHeaderRates, RENDER_FETCH, type HeaderRates } from "./nbu/rates";

/**
 * Page data loaders. EVERY loader starts with `await connection()` so any page using it renders
 * dynamically (ƒ) — data is read from disk on every request. Loaders throw DataFileError for
 * corrupt files (the root layout checks `getShellData().dataProblems` first and shows them).
 */

export type SearchParams = Record<string, string | string[] | undefined>;

// ------------------------------------------------------------------ shared helpers

const headerRatesForRequest = cache((today: ISODate) => getHeaderRates(today, { fetch: RENDER_FETCH }));

/**
 * One snapshot read per request (React `cache` is request-scoped): a page usually calls two loaders
 * (getFormOptions + its own), and each used to re-read and re-validate every file. Services never use
 * this — they always read fresh data under the write lock.
 */
const snapshotForRequest = cache(() => readSnapshot());

/** Today's FX map for balance conversion (from the header rates). */
export function fxFromHeaderRates(rates: HeaderRates): FxRates {
  const one = (c: ForeignCurrency) => {
    const r = rates[c];
    return r ? { rate: r.rate, date: r.effectiveDate, stale: r.stale } : null;
  };
  return { USD: one("USD"), EUR: one("EUR"), PLN: one("PLN") };
}

const groupOrder = (g: Account["group"]) => ACCOUNT_GROUPS.indexOf(g);

/** Accounts sorted by group (Active, Freelancer, Investments, Deposits, Other), then name. */
function sortAccounts(accounts: readonly Account[]): Account[] {
  return [...accounts].sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || a.name.localeCompare(b.name));
}


const newestFirst = <T extends { date: string; createdAt: string }>(a: T, b: T) =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

export interface ExpenseRow extends Expense {
  category: Category | null;
  account: Account | null;
}

function joinExpenses(expenses: readonly Expense[], s: Pick<DataSnapshot, "accounts" | "categories">): ExpenseRow[] {
  const acc = new Map(s.accounts.map((a) => [a.id, a]));
  const cat = new Map(s.categories.map((c) => [c.id, c]));
  return expenses.map((e) => ({ ...e, category: cat.get(e.categoryId) ?? null, account: acc.get(e.accountId) ?? null }));
}

/**
 * Declarations and paid-vs-due statuses of every quarter of `years` (ascending, de-duplicated).
 * Upcoming deadlines can belong to the previous year (Q4 is filed/paid in Jan–Feb), so callers pass
 * every year involved.
 */
function taxYears(
  s: Pick<DataSnapshot, "incomes" | "expenses" | "settings">,
  years: Iterable<number>,
  today: ISODate,
): { declarations: QuarterlyDeclaration[]; statuses: QuarterPaymentStatus[] } {
  const payments = summarizeTaxPayments(s.expenses);
  const declarations = [...new Set(years)]
    .sort((a, b) => a - b)
    .map((y) =>
      quarterlyDeclaration(y, {
        incomes: s.incomes.filter((i) => i.kind === "freelance" && yearOf(i.date) === y),
        settings: s.settings,
      }),
    );
  return { declarations, statuses: declarations.flatMap((d) => declarationPaymentStatus(d, payments, today)) };
}

/**
 * Years checked for overdue tax payments regardless of the year being viewed: last year, this year,
 * and every earlier year (from the first year with rule tables) that has freelance income — so an
 * unpaid quarter never disappears from the default views once its deadline has passed.
 */
function taxWatchYears(s: Pick<DataSnapshot, "incomes">, today: ISODate): number[] {
  const current = yearOf(today);
  const years = new Set([current - 1, current]);
  for (const i of s.incomes) {
    if (i.kind !== "freelance") continue;
    const y = yearOf(i.date);
    if (y >= FIRST_RULES_YEAR && y <= current) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}

/** Multi-value id filter: `?category=a,b` and/or `?category=a&category=b` → unique trimmed ids. */
function parseIdList(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(raw.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
}

// ------------------------------------------------------------------ app shell

export interface ShellData {
  today: ISODate;
  dataDir: string;
  /** Non-empty → a data file is corrupt; render the problems instead of the page. */
  dataProblems: DataHealthProblem[];
  /** Open debts past their due date (sidebar badge). */
  overdueDebts: number;
}

/**
 * Root layout: today and data health. Header NBU rates are NOT awaited here — the layout streams
 * them through `getHeaderRatesData()` inside a Suspense boundary, so a slow NBU never blocks the shell.
 */
export async function getShellData(): Promise<ShellData> {
  await connection();
  const today = todayKyiv();
  const dataProblems = await checkDataHealth();
  const overdueDebts = dataProblems.length ? 0 : overdueDebtCount(await readCollection("debts"), today);
  return { today, dataDir: getDataDir(), dataProblems, overdueDebts };
}

/** Header rates (USD/EUR + change vs previous day + tomorrow); shared with page loaders within a request. */
export async function getHeaderRatesData(): Promise<HeaderRates> {
  await connection();
  return headerRatesForRequest(todayKyiv());
}

// ------------------------------------------------------------------ form options

export interface FormOptions {
  today: ISODate;
  /** Non-archived accounts, sorted by group then name. */
  accounts: Account[];
  /** Non-archived categories, pinned first, then by name (includes Taxes). */
  categories: Category[];
  defaultActiveAccountId: string;
  /** First non-archived freelancer account per currency (default target for freelance income). */
  defaultFreelancerAccountIds: Partial<Record<Currency, string>>;
  taxCategoryId: string | null;
  /** Current balance (account currency) per account id — for "Update balance" defaults. */
  balances: Record<string, number>;
}

export async function getFormOptions(): Promise<FormOptions> {
  await connection();
  const today = todayKyiv();
  const s = await snapshotForRequest();
  const accounts = sortAccounts(s.accounts.filter((a) => !a.archived));
  const defaultFreelancerAccountIds: Partial<Record<Currency, string>> = {};
  for (const a of accounts) {
    if (a.group === "freelancer" && !defaultFreelancerAccountIds[a.currency]) defaultFreelancerAccountIds[a.currency] = a.id;
  }
  return {
    today,
    accounts,
    categories: sortCategories(s.categories.filter((c) => !c.archived)),
    defaultActiveAccountId: s.settings.defaultActiveAccountId,
    defaultFreelancerAccountIds,
    taxCategoryId: s.categories.find((c) => c.systemKey === "taxes")?.id ?? null,
    balances: computeBalances(s, { asOf: today }),
  };
}

// ------------------------------------------------------------------ overview

export interface OverviewData {
  today: ISODate;
  rates: HeaderRates;
  balances: BalanceSheet;
  thisMonth: { range: DateRange; totals: PeriodTotals };
  /** Last 10 movements across incomes, expenses, transfers, adjustments (the page shows 5). */
  recent: TransactionRow[];
  /** True when there are no incomes/expenses/transfers/adjustments at all (fresh install). */
  isEmpty: boolean;
  /** Next 6 tax deadlines from today (with daysLeft); the card headlines the first one that needs action. */
  taxDeadlines: TaxDeadline[];
  /**
   * Paid vs due for every quarter of the watched years (last year, this year, earlier years with
   * freelance income) — covers Q4 deadlines in Jan–Feb and overdue quarters of earlier years.
   */
  taxPaymentStatus: QuarterPaymentStatus[];
  /** Overdue tax payments of any watched year, oldest first. */
  taxOverdue: OverdueItem[];
}

export async function getOverviewData(): Promise<OverviewData> {
  await connection();
  const today = todayKyiv();
  const [s, rates] = await Promise.all([snapshotForRequest(), headerRatesForRequest(today)]);
  const range = resolvePeriod("this-month", today);
  // Fetch a few extra: "Pay ЄСВ" deadlines with nothing due or paid (e.g. an employer covers ЄСВ) are dropped.
  const allDeadlines = upcomingDeadlines(today, { count: 9 });
  const { statuses: taxPaymentStatus } = taxYears(s, [...taxWatchYears(s, today), ...allDeadlines.map((d) => d.year)], today);
  const taxDeadlines = relevantDeadlines(allDeadlines, taxPaymentStatus).slice(0, 6);
  return {
    today,
    rates,
    balances: balanceSheet(s, fxFromHeaderRates(rates), { asOf: today }),
    thisMonth: { range, totals: periodTotals(s, range) },
    recent: recentTransactions(s, 10),
    isEmpty: s.incomes.length + s.expenses.length + s.transfers.length + s.adjustments.length === 0,
    taxDeadlines,
    taxPaymentStatus,
    taxOverdue: overdueItems(taxPaymentStatus),
  };
}

// ------------------------------------------------------------------ expenses

export interface ExpenseFilters {
  preset: PeriodPreset;
  from: ISODate;
  to: ISODate;
  /** Every selected category (`?category=a,b`); empty = all. */
  categoryIds: string[];
  /** The first of `categoryIds` (single-category convenience). */
  categoryId: string | null;
  accountId: string | null;
  q: string;
}

export interface ExpensesPageData {
  today: ISODate;
  filters: ExpenseFilters;
  range: DateRange;
  /** Filtered, newest first. */
  rows: ExpenseRow[];
  totals: {
    count: number;
    totalUah: number;
    /** Native totals per currency of the filtered set. */
    byCurrency: { currency: Currency; amount: number }[];
  };
  /** The whole period (all accounts and categories, filters aside): spent, income (net of fees), net. */
  period: Pick<PeriodTotals, "spendingUah" | "incomeUah" | "netUah">;
  /** The period's spending per category (filters aside), biggest first. */
  byCategory: CategorySpending[];
  /** All categories / accounts (incl. archived) for labels and filter pickers. */
  categories: Category[];
  accounts: Account[];
  /** Any expense at all (tells a fresh install from an empty filter/period). */
  hasAnyExpenses: boolean;
}

/**
 * Search params: period, from, to (custom), category (one or more ids, comma-separated), account, q.
 * Default period: this-month.
 */
export async function getExpensesPageData(searchParams: SearchParams = {}): Promise<ExpensesPageData> {
  await connection();
  const today = todayKyiv();
  const s = await snapshotForRequest();
  const { preset, range } = parsePeriodParams(searchParams, today, {
    defaultPreset: "this-month",
    dataRange: dataDateRange(s),
  });
  // Unknown ids (a deleted category in an old link) are dropped rather than matching nothing.
  const knownCategories = new Set(s.categories.map((c) => c.id));
  const categoryIds = parseIdList(searchParams.category).filter((id) => knownCategories.has(id));
  const accountId = firstParam(searchParams.account) || null;
  const q = (firstParam(searchParams.q) ?? "").trim();
  const needle = q.toLocaleLowerCase("uk-UA");
  const rows = joinExpenses(
    s.expenses.filter(
      (e) =>
        e.date >= range.from &&
        e.date <= range.to &&
        (categoryIds.length === 0 || categoryIds.includes(e.categoryId)) &&
        (!accountId || e.accountId === accountId),
    ),
    s,
  )
    .filter((e) => {
      if (!needle) return true;
      const hay = [e.note ?? "", e.category?.name ?? "", e.account?.name ?? "", String(e.amount)]
        .join(" ")
        .toLocaleLowerCase("uk-UA");
      return hay.includes(needle);
    })
    .sort(newestFirst);
  const byCurrency = new Map<Currency, number>();
  let total = 0;
  for (const e of rows) {
    total += toMinor(e.amountUah);
    byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + toMinor(e.amount));
  }
  const { spendingUah, incomeUah, netUah } = periodTotals(s, range);
  return {
    today,
    filters: { preset, from: range.from, to: range.to, categoryIds, categoryId: categoryIds[0] ?? null, accountId, q },
    range,
    rows,
    totals: {
      count: rows.length,
      totalUah: fromMinor(total),
      byCurrency: [...byCurrency.entries()].map(([currency, minor]) => ({ currency, amount: fromMinor(minor) })),
    },
    period: { spendingUah, incomeUah, netUah },
    byCategory: spendingByCategory(s, range),
    categories: sortCategories(s.categories),
    accounts: sortAccounts(s.accounts),
    hasAnyExpenses: s.expenses.length > 0,
  };
}

// ------------------------------------------------------------------ income

export type IncomeKindFilter = "all" | "salary" | "freelance";

export interface IncomeRow extends Income {
  account: Account | null;
  /** UAH actually credited (amount − fee at the income rate). */
  receivedUah: number;
  feeUah: number;
}

export interface IncomePageData {
  today: ISODate;
  filters: { preset: PeriodPreset; from: ISODate; to: ISODate; kind: IncomeKindFilter };
  range: DateRange;
  /** Filtered by period AND kind, newest first. */
  rows: IncomeRow[];
  /** Totals for the period across BOTH kinds (independent of the kind tab). */
  totals: {
    count: number;
    /** Per-kind counts in the period (for tab labels). */
    salaryCount: number;
    freelanceCount: number;
    salaryUah: number;
    /** Gross freelance (tax base). */
    freelanceUah: number;
    feesUah: number;
    /** salary + freelance − fees. */
    receivedUah: number;
  };
  accounts: Account[];
  /** Any income at all (tells a fresh install from an empty period). */
  hasAnyIncome: boolean;
}

/** Search params: period (default this-year), from, to, kind=all|salary|freelance. */
export async function getIncomePageData(searchParams: SearchParams = {}): Promise<IncomePageData> {
  await connection();
  const today = todayKyiv();
  const s = await snapshotForRequest();
  const { preset, range } = parsePeriodParams(searchParams, today, {
    defaultPreset: "this-year",
    dataRange: dataDateRange(s),
  });
  const rawKind = firstParam(searchParams.kind);
  const kind: IncomeKindFilter = rawKind === "salary" || rawKind === "freelance" ? rawKind : "all";
  const acc = new Map(s.accounts.map((a) => [a.id, a]));
  const inPeriod = s.incomes.filter((i) => i.date >= range.from && i.date <= range.to);
  const totals = periodTotals({ incomes: inPeriod, expenses: [], categories: [] }, range);
  const rows: IncomeRow[] = inPeriod
    .filter((i) => kind === "all" || i.kind === kind)
    .map((i) => ({ ...i, account: acc.get(i.accountId) ?? null, receivedUah: receivedUah(i), feeUah: feeUah(i) }))
    .sort(newestFirst);
  return {
    today,
    filters: { preset, from: range.from, to: range.to, kind },
    range,
    rows,
    totals: {
      count: inPeriod.length,
      salaryCount: inPeriod.filter((i) => i.kind === "salary").length,
      freelanceCount: inPeriod.filter((i) => i.kind === "freelance").length,
      salaryUah: totals.salaryUah,
      freelanceUah: totals.freelanceUah,
      feesUah: totals.freelanceFeesUah,
      receivedUah: totals.incomeUah,
    },
    accounts: sortAccounts(s.accounts),
    hasAnyIncome: s.incomes.length > 0,
  };
}

// ------------------------------------------------------------------ freelance / taxes

export interface FreelanceIncomeRow extends Income {
  account: Account | null;
  receivedUah: number;
  feeUah: number;
}

export interface FreelancePageData {
  today: ISODate;
  year: number;
  /** Years that have freelance income, plus the current year (desc). */
  years: number[];
  settings: Settings;
  /** Freelance incomes of `year`, oldest first, joined with accounts. */
  incomes: FreelanceIncomeRow[];
  /** Same incomes as plain Income[] — pass to calculateTaxes() on the client (limit is cumulative per year). */
  taxIncomes: Income[];
  /** Default month selection: YTD for the current year, the whole year for past years. */
  defaultMonths: ISOMonth[];
  declaration: QuarterlyDeclaration;
  payments: TaxPaymentTotals;
  paymentStatus: QuarterPaymentStatus[];
  /** All deadlines for the quarters of `year`. */
  yearDeadlines: TaxDeadline[];
  /** Next deadlines from today (with daysLeft). */
  upcomingDeadlines: TaxDeadline[];
  /**
   * Paid vs due for every year that `upcomingDeadlines` touches (independent of `year`): use it with
   * `upcomingDeadlines` so a previous-year Q4 deadline in Jan–Feb shows its amounts.
   */
  upcomingPaymentStatus: QuarterPaymentStatus[];
  /**
   * Overdue payments of every watched year (last year, this year, earlier years with freelance income),
   * independent of `year` — oldest first.
   */
  overdue: OverdueItem[];
  /**
   * Quarters offered by "Record tax payment" (oldest first): the viewed year, last year, this year and
   * every year with an overdue item — so last year's Q4 (paid in Jan–Feb) is always selectable.
   */
  paymentOptions: PaymentQuarterOption[];
  /** Non-archived UAH accounts (tax payments are made from these). */
  uahAccounts: Account[];
  defaultActiveAccountId: string;
  taxCategoryId: string | null;
  /**
   * The "Include ЄСВ" switch (`?esv=1`): a VIEW-ONLY preview of the minimum ЄСВ when the saved mode owes
   * none (employer pays / exempt). Every real figure above (declaration, statuses, overdue, options)
   * stays as saved; the preview only adds these optional amounts.
   */
  esvOptional: {
    /** The saved ЄСВ mode owes nothing → the switch is offered. */
    available: boolean;
    /** The switch is on. */
    included: boolean;
    /** Minimum ЄСВ per quarter (viewed year + upcoming deadline years) while included; {} otherwise. */
    byQuarter: Record<string, number>;
  };
  /** Settings for the client-side calculator: the saved ones, or with the minimum ЄСВ while included. */
  viewSettings: Settings;
}

/** Search params: year (default: current Kyiv year), esv=1 (preview the optional ЄСВ). */
export async function getFreelancePageData(searchParams: SearchParams = {}): Promise<FreelancePageData> {
  await connection();
  const today = todayKyiv();
  const currentYear = yearOf(today);
  const rawYear = Number(firstParam(searchParams.year));
  const year = Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= currentYear + 1 ? rawYear : currentYear;
  const s = await snapshotForRequest();
  const acc = new Map(s.accounts.map((a) => [a.id, a]));

  const allFreelance = s.incomes.filter((i) => i.kind === "freelance");
  const years = [...new Set([currentYear, ...allFreelance.map((i) => yearOf(i.date))])].sort((a, b) => b - a);
  const taxIncomes = allFreelance
    .filter((i) => yearOf(i.date) === year)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const incomes = taxIncomes.map((i) => ({
    ...i,
    account: acc.get(i.accountId) ?? null,
    receivedUah: receivedUah(i),
    feeUah: feeUah(i),
  }));

  const declaration = quarterlyDeclaration(year, { incomes: taxIncomes, settings: s.settings });
  const payments = summarizeTaxPayments(s.expenses);
  // Fetch a few extra: "Pay ЄСВ" deadlines with nothing due or paid (e.g. an employer covers ЄСВ) are dropped.
  const allUpcoming = upcomingDeadlines(today, { count: 9 });
  const watch = taxWatchYears(s, today);
  const cross = taxYears(s, [...watch, year, ...allUpcoming.map((d) => d.year)], today);
  const available = esvOptionalAvailable(s.settings.tax);
  const included = available && firstParam(searchParams.esv) === "1";
  const byQuarter = included ? optionalEsvByQuarter([year, ...allUpcoming.map((d) => d.year)], s.settings) : {};
  // While the optional ЄСВ is included, its "Pay ЄСВ" deadlines stay (shown as optional, never as "Next").
  const upcoming = allUpcoming
    .filter((d) => d.kind !== "esv" || esvApplies(cross.statuses.find((st) => st.period === d.period)) || (byQuarter[d.period] ?? 0) > 0)
    .slice(0, 6);
  const watched = new Set(watch);
  const overdue = overdueItems(cross.statuses.filter((st) => watched.has(yearOf(st.period))));
  const optionYears = new Set([year, currentYear - 1, currentYear, ...overdue.map((o) => yearOf(o.period))]);

  return {
    today,
    year,
    years,
    settings: s.settings,
    incomes,
    taxIncomes,
    defaultMonths: yearToDateMonths(year, today),
    declaration,
    payments,
    paymentStatus: declarationPaymentStatus(declaration, payments, today),
    yearDeadlines: deadlinesForYear(year),
    upcomingDeadlines: upcoming,
    upcomingPaymentStatus: cross.statuses,
    overdue,
    paymentOptions: paymentQuarterOptionsForYears(
      cross.declarations.filter((d) => optionYears.has(d.year)),
      cross.statuses,
      today,
    ),
    uahAccounts: sortAccounts(s.accounts.filter((a) => !a.archived && a.currency === "UAH")),
    defaultActiveAccountId: s.settings.defaultActiveAccountId,
    taxCategoryId: s.categories.find((c) => c.systemKey === "taxes")?.id ?? null,
    esvOptional: { available, included, byQuarter },
    viewSettings: included ? withMinimumEsv(s.settings) : s.settings,
  };
}

// ------------------------------------------------------------------ accounts

export interface AccountUsage {
  incomes: number;
  expenses: number;
  transfers: number;
  adjustments: number;
  /** Investment deposits / withdrawals from outside + value updates. */
  investments: number;
  /** Debt repayments received into / paid from the account. */
  debts: number;
  total: number;
}

export interface TransferRow extends Transfer {
  fromAccount: Account | null;
  toAccount: Account | null;
  fromCurrency: Currency;
  toCurrency: Currency;
  /** toAmount / fromAmount (4 decimals). */
  effectiveRate: number;
}

export interface AdjustmentRow extends Adjustment {
  account: Account | null;
  currency: Currency;
}

export interface AccountsPageData {
  today: ISODate;
  rates: HeaderRates;
  balances: BalanceSheet;
  /** Every account (incl. archived) with usage counts — delete is allowed only when usage.total === 0. */
  accounts: { account: Account; usage: AccountUsage; balance: number; isDefault: boolean }[];
  transfers: TransferRow[];
  adjustments: AdjustmentRow[];
  defaultActiveAccountId: string;
}

export async function getAccountsPageData(): Promise<AccountsPageData> {
  await connection();
  const today = todayKyiv();
  const [s, rates] = await Promise.all([snapshotForRequest(), headerRatesForRequest(today)]);
  const acc = new Map(s.accounts.map((a) => [a.id, a]));
  const balances = computeBalances(s, { asOf: today });
  const curOf = (id: string): Currency => acc.get(id)?.currency ?? "UAH";
  return {
    today,
    rates,
    balances: balanceSheet(s, fxFromHeaderRates(rates), { asOf: today }),
    accounts: sortAccounts(s.accounts).map((a) => ({
      account: a,
      usage: accountUsage(a.id, s),
      balance: balances[a.id] ?? 0,
      isDefault: a.id === s.settings.defaultActiveAccountId,
    })),
    transfers: [...s.transfers].sort(newestFirst).map((t) => ({
      ...t,
      fromAccount: acc.get(t.fromAccountId) ?? null,
      toAccount: acc.get(t.toAccountId) ?? null,
      fromCurrency: curOf(t.fromAccountId),
      toCurrency: curOf(t.toAccountId),
      effectiveRate: effectiveRate(t.fromAmount, t.toAmount),
    })),
    adjustments: [...s.adjustments]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((a) => ({ ...a, account: acc.get(a.accountId) ?? null, currency: curOf(a.accountId) })),
    defaultActiveAccountId: s.settings.defaultActiveAccountId,
  };
}

// ------------------------------------------------------------------ investments

export interface InvestmentsPageData {
  today: ISODate;
  rates: HeaderRates;
  /** Today's FX for UAH equivalents (from the header rates). */
  fx: FxRates;
  /**
   * Investment and bank-deposit accounts (non-archived, plus archived ones that still hold value or have
   * history), by group (Investments, then Bank deposits) and name.
   */
  summaries: InvestmentSummary[];
  /** Totals of everything on the page. */
  totals: InvestmentTotals;
  /** One section per tracked group that has accounts: its accounts and subtotals. */
  sections: { group: TrackedGroup; summaries: InvestmentSummary[]; totals: InvestmentTotals }[];
  /** Non-archived investment and deposit accounts — for the dialogs. */
  investmentAccounts: Account[];
  /** Your other non-archived accounts — where a deposit can come from / a withdrawal can go to. */
  otherAccounts: Account[];
}

export async function getInvestmentsPageData(): Promise<InvestmentsPageData> {
  await connection();
  const today = todayKyiv();
  const [s, rates] = await Promise.all([snapshotForRequest(), headerRatesForRequest(today)]);
  const fx = fxFromHeaderRates(rates);
  const summaries = s.accounts
    .filter(isInvestmentAccount)
    .map((a) => investmentSummary(a, s, today))
    .filter((x) => !x.account.archived || x.value !== 0 || x.movements.length > 0 || x.valuations.length > 0)
    .sort(
      (a, b) =>
        TRACKED_GROUPS.indexOf(a.account.group as TrackedGroup) - TRACKED_GROUPS.indexOf(b.account.group as TrackedGroup) ||
        a.account.name.localeCompare(b.account.name),
    );
  const sections = TRACKED_GROUPS.map((group) => {
    const list = summaries.filter((x) => x.account.group === group);
    return { group, summaries: list, totals: investmentTotals(list, fx) };
  }).filter((x) => x.summaries.length > 0);
  return {
    today,
    rates,
    fx,
    summaries,
    totals: investmentTotals(summaries, fx),
    sections,
    investmentAccounts: sortAccounts(s.accounts.filter((a) => !a.archived && isInvestmentAccount(a))),
    otherAccounts: sortAccounts(s.accounts.filter((a) => !a.archived && !isInvestmentAccount(a))),
  };
}

// ------------------------------------------------------------------ debts

export type DebtsView = "open" | "settled" | "all";

export interface DebtRow {
  debt: Debt;
  status: DebtStatus;
  /** Newest first, each with the account it arrived in / left (null = none, or unknown). */
  repayments: (DebtRepayment & { account: Account | null })[];
}

export interface DebtsPageData {
  today: ISODate;
  rates: HeaderRates;
  summary: DebtsSummary;
  view: DebtsView;
  /** Rows for the current view in display order (overdue → due soon → upcoming → no due date → settled). */
  lent: DebtRow[];
  borrowed: DebtRow[];
  counts: { open: number; settled: number };
  /** Every counterparty used so far, most recent first (name suggestions in the dialog). */
  people: string[];
  /** Non-archived accounts (where a repayment arrives / is paid from), sorted by group then name. */
  accounts: Account[];
  defaultActiveAccountId: string;
}

export async function getDebtsPageData(searchParams: SearchParams = {}): Promise<DebtsPageData> {
  await connection();
  const today = todayKyiv();
  const [s, rates] = await Promise.all([snapshotForRequest(), headerRatesForRequest(today)]);
  const raw = firstParam(searchParams.view);
  const view: DebtsView = raw === "settled" || raw === "all" ? raw : "open";
  const acc = new Map(s.accounts.map((a) => [a.id, a]));
  const rows: DebtRow[] = withStatus(s.debts, today).map(({ debt, status }) => ({
    debt,
    status,
    repayments: [...debt.repayments]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r, account: r.accountId ? (acc.get(r.accountId) ?? null) : null })),
  }));
  const inView = rows.filter((r) => view === "all" || (view === "settled") === r.status.settled);
  return {
    today,
    rates,
    summary: summarizeDebts(s.debts, fxFromHeaderRates(rates), today),
    view,
    lent: inView.filter((r) => r.debt.direction === "lent"),
    borrowed: inView.filter((r) => r.debt.direction === "borrowed"),
    counts: { open: rows.filter((r) => !r.status.settled).length, settled: rows.filter((r) => r.status.settled).length },
    people: debtPeople(s.debts),
    accounts: sortAccounts(s.accounts.filter((a) => !a.archived)),
    defaultActiveAccountId: s.settings.defaultActiveAccountId,
  };
}

/** Distinct counterparties (case-insensitive), most recently used first. */
function debtPeople(debts: readonly Debt[]): string[] {
  const seen = new Map<string, string>();
  for (const d of [...debts].sort((a, b) => b.date.localeCompare(a.date))) {
    const key = d.counterparty.trim().toLocaleLowerCase("uk-UA");
    if (!seen.has(key)) seen.set(key, d.counterparty.trim());
  }
  return [...seen.values()];
}

// ------------------------------------------------------------------ settings

export interface SettingsPageData {
  today: ISODate;
  settings: Settings;
  /** All categories (incl. archived), pinned first, then by name, with usage. Delete allowed when expenseCount === 0 and not Taxes. */
  categories: { category: Category; expenseCount: number; totalUah: number }[];
  accounts: { account: Account; usage: AccountUsage; balance: number; isDefault: boolean }[];
  /** Absolute data directory. */
  dataDir: string;
  files: { name: string; path: string; exists: boolean; sizeBytes: number | null }[];
  /** Read-only rule tables in effect. */
  rules: RulesTable;
}

export async function getSettingsPageData(): Promise<SettingsPageData> {
  await connection();
  const s = await snapshotForRequest();
  const usage = new Map<string, { count: number; minor: number }>();
  for (const e of s.expenses) {
    const u = usage.get(e.categoryId) ?? { count: 0, minor: 0 };
    u.count += 1;
    u.minor += toMinor(e.amountUah);
    usage.set(e.categoryId, u);
  }
  const today = todayKyiv();
  const balances = computeBalances(s, { asOf: today });
  const files = await Promise.all(
    ALL_DATA_FILES.map(async (name) => {
      const p = dataFilePath(name);
      try {
        const st = await fs.stat(p);
        return { name, path: p, exists: true, sizeBytes: st.size };
      } catch {
        return { name, path: p, exists: false, sizeBytes: null };
      }
    }),
  );
  return {
    today,
    settings: s.settings,
    categories: sortCategories(s.categories).map((c) => ({
      category: c,
      expenseCount: usage.get(c.id)?.count ?? 0,
      totalUah: fromMinor(usage.get(c.id)?.minor ?? 0),
    })),
    accounts: sortAccounts(s.accounts).map((a) => ({
      account: a,
      usage: accountUsage(a.id, s),
      balance: balances[a.id] ?? 0,
      isDefault: a.id === s.settings.defaultActiveAccountId,
    })),
    dataDir: getDataDir(),
    files,
    rules: rulesTable(),
  };
}
