/**
 * ФОП group 3 tax engine (research/tax-rules.md §2). Pure + isomorphic, so client components
 * can recompute instantly when the user toggles months.
 *
 * Rounding (§5.12): each FX entry is already rounded to kopecks (Income.amountUah); taxes are
 * rounded ONCE per aggregate (a month row, a quarter subtotal, the selection total, a cumulative
 * declaration period) with HALF-UP. Quarterly payable = difference of rounded cumulative accruals.
 * Only FREELANCE incomes are taxable; salary is ignored.
 */
import {
  addDays,
  diffDays,
  formatDate,
  formatMonth,
  isValidMonth,
  makeDate,
  monthOf,
  monthsOfYear,
  monthStart,
  quarterEnd,
  quarterKey,
  quarterKeyOf,
  quarterMonths,
  quarterOf,
  QUARTERS,
  yearOf,
  type ISODate,
  type ISOMonth,
  type Quarter,
  type QuarterKey,
} from "../dates";
import { BP_SCALE, divRoundHalfUp, fromMinor, toMinor } from "../money";
import type { Expense, Income, TaxKind, TaxSettings } from "../types";
import { quarterDeadlines, type QuarterDeadlines } from "./deadlines";
import {
  ESV_RATE_BP,
  incomeLimit,
  isRulesAssumed,
  maxEsvBase,
  militaryLevyRateBp,
  minimumEsv,
  minimumWage,
  OVER_LIMIT_RATE_BP,
  singleTaxRateBp,
} from "./rules";

export type TaxSettingsLike = TaxSettings | { tax: TaxSettings };

function taxOf(s: TaxSettingsLike): TaxSettings {
  return "tax" in s ? s.tax : s;
}

/** minor × bp accumulator → rounded minor (HALF-UP). */
function roundBpAcc(acc: bigint): number {
  return Number(divRoundHalfUp(acc, BigInt(BP_SCALE)));
}

/** Freelance incomes sorted by date, then creation order (tax-rules §2.2). */
export function freelanceIncomes(incomes: readonly Income[]): Income[] {
  return incomes
    .filter((i) => i.kind === "freelance")
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

// ------------------------------------------------------------------ limit split

export interface LimitSplit {
  incomeId: string;
  date: ISODate;
  month: ISOMonth;
  amountUah: number;
  withinUah: number;
  excessUah: number;
  /** Cumulative year-to-date income AFTER this entry. */
  cumulativeUah: number;
}

/**
 * Split each freelance income of `year` into the part within the annual limit and the excess
 * (income EQUAL to the limit is fully within). One entry may be split.
 */
export function splitByLimit(incomes: readonly Income[], year: number): LimitSplit[] {
  const limit = toMinor(incomeLimit(year));
  let cum = 0;
  return freelanceIncomes(incomes)
    .filter((i) => yearOf(i.date) === year)
    .map((i) => {
      const amt = toMinor(i.amountUah);
      const within = Math.max(0, Math.min(amt, limit - cum));
      cum += amt;
      return {
        incomeId: i.id,
        date: i.date,
        month: monthOf(i.date),
        amountUah: i.amountUah,
        withinUah: fromMinor(within),
        excessUah: fromMinor(amt - within),
        cumulativeUah: fromMinor(cum),
      };
    });
}

export type LimitLevel = "ok" | "80" | "90" | "reached" | "exceeded";

export interface LimitStatus {
  year: number;
  limit: number;
  /** All freelance income recorded for the year (incl. months not selected). */
  incomeUah: number;
  /** Cumulative income through the last selected month of this year (= incomeUah if none selected). */
  incomeThroughSelectionUah: number;
  remainingUah: number;
  /** incomeUah / limit (fraction). */
  pct: number;
  exceeded: boolean;
  level: LimitLevel;
  /** Date of the first income that went over the limit. */
  crossingDate: ISODate | null;
  crossingMonth: ISOMonth | null;
  crossingQuarter: QuarterKey | null;
  /** 1st day of the month after the crossing quarter: must move to the general system (§2.6). */
  forcedSwitchFrom: ISODate | null;
  /** Application for the switch is due by the 20th of the month after the crossing quarter. */
  applicationDueBy: ISODate | null;
  rulesAssumed: boolean;
}

export function limitStatus(incomes: readonly Income[], year: number, lastSelectedMonth?: ISOMonth): LimitStatus {
  const splits = splitByLimit(incomes, year);
  const limit = incomeLimit(year);
  const total = splits.length ? toMinor(splits[splits.length - 1].cumulativeUah) : 0;
  let through = total;
  if (lastSelectedMonth) {
    through = 0;
    for (const s of splits) if (s.month <= lastSelectedMonth) through = toMinor(s.cumulativeUah);
  }
  const crossing = splits.find((s) => s.excessUah > 0) ?? null;
  const limitMinor = toMinor(limit);
  const pct = limitMinor === 0 ? 0 : total / limitMinor;
  const exceeded = total > limitMinor;
  let forcedSwitchFrom: ISODate | null = null;
  let applicationDueBy: ISODate | null = null;
  if (crossing) {
    const q = quarterOf(crossing.date);
    forcedSwitchFrom = addDays(quarterEnd(year, q), 1);
    applicationDueBy = makeDate(yearOf(forcedSwitchFrom), Number(forcedSwitchFrom.slice(5, 7)), 20);
  }
  const level: LimitLevel = exceeded ? "exceeded" : pct >= 1 ? "reached" : pct >= 0.9 ? "90" : pct >= 0.8 ? "80" : "ok";
  return {
    year,
    limit,
    incomeUah: fromMinor(total),
    incomeThroughSelectionUah: fromMinor(through),
    remainingUah: fromMinor(Math.max(0, limitMinor - total)),
    pct,
    exceeded,
    level,
    crossingDate: crossing?.date ?? null,
    crossingMonth: crossing?.month ?? null,
    crossingQuarter: crossing ? quarterKeyOf(crossing.date) : null,
    forcedSwitchFrom,
    applicationDueBy,
    rulesAssumed: isRulesAssumed(year),
  };
}

// ------------------------------------------------------------------ ЄСВ

export type EsvReason =
  | "exempt"
  | "before-registration"
  | "after-deregistration"
  | "exempt-period"
  | "opt-out-2024"
  | "employed"
  | "uncovered"
  | "outside-employment"
  | "minimum"
  | "custom";

export const ESV_REASON_LABELS: Record<EsvReason, string> = {
  exempt: "Exempt",
  "before-registration": "Before ФОП registration",
  "after-deregistration": "After ФОП deregistration",
  "exempt-period": "Exempt period (Settings)",
  "opt-out-2024": "2024 opt-out (п. 9-19)",
  employed: "Covered by employer",
  uncovered: "Not covered by employer — minimum",
  "outside-employment": "Outside employment — minimum",
  minimum: "Minimum contribution",
  custom: "Custom base",
};

export interface EsvMonth {
  month: ISOMonth;
  amount: number;
  reason: EsvReason;
  /** Base the 22% applied to (null when nothing is due). */
  base: number | null;
  minimumWage: number;
}

/** Whether `month` falls inside one of the exempt month ranges (inclusive; `to: null` = open-ended). */
export function inEsvExemptPeriod(month: ISOMonth, periods: TaxSettings["esvExemptPeriods"]): boolean {
  return (periods ?? []).some((p) => month >= p.from && (p.to === null || month <= p.to));
}

/**
 * Whether `month` is inside an exempt period marked as military service. A mobilised / contract
 * self-employed person accrues no single tax and no military levy for those months — from the month of
 * call-up through the month of demobilisation (ПКУ розд. XX підр. 10 п. 25; tax-rules §4.2). The income
 * still counts towards the annual limit.
 */
export function inMilitaryService(month: ISOMonth, settings: TaxSettingsLike): boolean {
  const periods = taxOf(settings).esvExemptPeriods ?? [];
  return periods.some((p) => p.militaryService === true && month >= p.from && (p.to === null || month <= p.to));
}

/**
 * ЄСВ for one month (§2.4 / SPEC Settings comment). No pro-rata for partial months.
 * Zero before the registration month, after the deregistration month, inside an exempt period
 * (§4.2) and — with the п. 9-19 opt-out — for 2024 months; otherwise by `esvMode`.
 */
export function esvForMonth(month: ISOMonth, settings: TaxSettingsLike): EsvMonth {
  const tax = taxOf(settings);
  const mw = minimumWage(month);
  const zero = (reason: EsvReason): EsvMonth => ({ month, amount: 0, reason, base: null, minimumWage: mw });
  const minimum = (reason: EsvReason): EsvMonth => ({ month, amount: minimumEsv(month), reason, base: mw, minimumWage: mw });

  if (tax.esvMode === "exempt") return zero("exempt");
  if (tax.fopRegisteredOn && month < monthOf(tax.fopRegisteredOn)) return zero("before-registration");
  if (tax.fopDeregisteredOn && month > monthOf(tax.fopDeregisteredOn)) return zero("after-deregistration");
  if (inEsvExemptPeriod(month, tax.esvExemptPeriods)) return zero("exempt-period");
  if (tax.esv2024OptOut && yearOf(month) === 2024) return zero("opt-out-2024");
  switch (tax.esvMode) {
    case "employed": {
      const afterStart = tax.employedFrom === null || month >= monthOf(tax.employedFrom);
      const beforeEnd = tax.employedTo === null || month <= monthOf(tax.employedTo);
      if (tax.esvUncoveredMonths.includes(month)) return minimum("uncovered");
      if (afterStart && beforeEnd) return zero("employed");
      return minimum("outside-employment");
    }
    case "minimum":
      return minimum("minimum");
    case "custom": {
      const max = maxEsvBase(month);
      const requested = tax.esvCustomMonthlyBase ?? mw;
      const base = Math.min(Math.max(requested, mw), max);
      return {
        month,
        amount: fromMinor(roundBpAcc(BigInt(toMinor(base)) * BigInt(ESV_RATE_BP))),
        reason: "custom",
        base,
        minimumWage: mw,
      };
    }
  }
}

// ------------------------------------------------------------------ calculator for selected months

export interface TaxMonthRow {
  month: ISOMonth;
  label: string;
  incomeUah: number;
  withinUah: number;
  excessUah: number;
  incomeCount: number;
  singleTax: number;
  levy: number;
  esv: number;
  esvReason: EsvReason;
  total: number;
  /** Month is on/after the forced switch to the general system — no single tax / levy is accrued (ЄСВ stays). */
  afterForcedSwitch: boolean;
  /** Month of military service (Settings → exempt periods): no single tax / levy is accrued on its income. */
  militaryService: boolean;
}

export interface TaxTotals {
  incomeUah: number;
  withinUah: number;
  excessUah: number;
  /** Rounded once over the whole aggregate. */
  singleTax: number;
  levy: number;
  /** Σ monthly ЄСВ (each already rounded). */
  esv: number;
  total: number;
  /** total / income; null when income is 0. */
  effectiveRate: number | null;
  /** (singleTax + levy) / income; null when income is 0. */
  effectiveRateExclEsv: number | null;
}

export interface TaxQuarterSubtotal extends TaxTotals {
  period: QuarterKey;
  /** Selected months of this quarter. */
  months: ISOMonth[];
}

export type TaxWarningCode =
  | "limit-80"
  | "limit-90"
  | "limit-reached"
  | "limit-exceeded"
  | "general-system"
  | "rules-assumed"
  | "income-before-registration"
  | "military-service";

export interface TaxWarning {
  code: TaxWarningCode;
  severity: "info" | "warning" | "critical";
  message: string;
  year?: number;
  month?: ISOMonth;
}

export interface TaxCalculation {
  /** Sorted, de-duplicated selection. */
  months: ISOMonth[];
  rows: TaxMonthRow[];
  quarters: TaxQuarterSubtotal[];
  totals: TaxTotals;
  /** One per year touched by the selection. */
  limits: LimitStatus[];
  warnings: TaxWarning[];
  rulesAssumed: boolean;
  singleTaxRateBp: number;
}

export interface CalculateTaxesInput {
  /** All incomes (salary is ignored). Pass every freelance income of the years involved — the limit is cumulative. */
  incomes: readonly Income[];
  /** Selected months (YYYY-MM). Invalid entries are ignored. */
  months: readonly string[];
  settings: TaxSettingsLike;
}

interface Acc {
  income: number;
  within: number;
  excess: number;
  count: number;
  st: bigint;
  levy: bigint;
  esv: number;
}

const emptyAcc = (): Acc => ({ income: 0, within: 0, excess: 0, count: 0, st: 0n, levy: 0n, esv: 0 });

function totalsFromAcc(a: Acc): TaxTotals {
  const singleTax = roundBpAcc(a.st);
  const levy = roundBpAcc(a.levy);
  const total = singleTax + levy + a.esv;
  return {
    incomeUah: fromMinor(a.income),
    withinUah: fromMinor(a.within),
    excessUah: fromMinor(a.excess),
    singleTax: fromMinor(singleTax),
    levy: fromMinor(levy),
    esv: fromMinor(a.esv),
    total: fromMinor(total),
    effectiveRate: a.income === 0 ? null : total / a.income,
    effectiveRateExclEsv: a.income === 0 ? null : (singleTax + levy) / a.income,
  };
}

function mergeAcc(into: Acc, a: Acc) {
  into.income += a.income;
  into.within += a.within;
  into.excess += a.excess;
  into.count += a.count;
  into.st += a.st;
  into.levy += a.levy;
  into.esv += a.esv;
}

export function calculateTaxes(input: CalculateTaxesInput): TaxCalculation {
  const tax = taxOf(input.settings);
  const months = [...new Set(input.months.filter(isValidMonth))].sort();
  const rateBp = singleTaxRateBp(tax);
  const years = [...new Set(months.map(yearOf))];

  const splitsByMonth = new Map<ISOMonth, LimitSplit[]>();
  const limits: LimitStatus[] = [];
  for (const y of years) {
    for (const s of splitByLimit(input.incomes, y)) {
      const list = splitsByMonth.get(s.month) ?? [];
      list.push(s);
      splitsByMonth.set(s.month, list);
    }
    const lastSel = months.filter((m) => yearOf(m) === y).at(-1);
    limits.push(limitStatus(input.incomes, y, lastSel));
  }
  const switchByYear = new Map(limits.map((l) => [l.year, l.forcedSwitchFrom]));

  const rows: TaxMonthRow[] = [];
  const total = emptyAcc();
  const byQuarter = new Map<QuarterKey, { months: ISOMonth[]; acc: Acc }>();
  const warnings: TaxWarning[] = [];
  let beforeRegistration = 0;
  const militaryMonths: ISOMonth[] = [];

  for (const month of months) {
    const acc = emptyAcc();
    const military = inMilitaryService(month, tax);
    if (military) militaryMonths.push(month);
    const switchFrom = switchByYear.get(yearOf(month)) ?? null;
    // §2.6: same rule as quarterlyDeclaration — no single tax / levy once on the general system; ЄСВ stays.
    const afterForcedSwitch = switchFrom !== null && month >= monthOf(switchFrom);
    for (const s of splitsByMonth.get(month) ?? []) {
      const within = toMinor(s.withinUah);
      const excess = toMinor(s.excessUah);
      const amount = toMinor(s.amountUah);
      acc.income += amount;
      acc.within += within;
      acc.excess += excess;
      acc.count += 1;
      if (!military && !afterForcedSwitch) {
        acc.st += BigInt(within) * BigInt(rateBp) + BigInt(excess) * BigInt(OVER_LIMIT_RATE_BP);
        acc.levy += BigInt(amount) * BigInt(militaryLevyRateBp(s.date, tax));
      }
      if (tax.fopRegisteredOn && s.date < tax.fopRegisteredOn) beforeRegistration += 1;
    }
    const esv = esvForMonth(month, tax);
    acc.esv = toMinor(esv.amount);
    const t = totalsFromAcc(acc);
    rows.push({
      month,
      label: formatMonth(month),
      incomeUah: t.incomeUah,
      withinUah: t.withinUah,
      excessUah: t.excessUah,
      incomeCount: acc.count,
      singleTax: t.singleTax,
      levy: t.levy,
      esv: t.esv,
      esvReason: esv.reason,
      total: t.total,
      afterForcedSwitch,
      militaryService: military,
    });
    mergeAcc(total, acc);
    const qk = quarterKeyOf(month);
    const q = byQuarter.get(qk) ?? { months: [], acc: emptyAcc() };
    q.months.push(month);
    mergeAcc(q.acc, acc);
    byQuarter.set(qk, q);
  }

  for (const l of limits) {
    const yearLabel = String(l.year);
    if (l.level === "exceeded") {
      warnings.push({
        code: "limit-exceeded",
        severity: "critical",
        year: l.year,
        message: `Income limit for ${yearLabel} exceeded on ${formatDate(l.crossingDate as string)}: the excess is taxed at 15% (+ military levy).`,
      });
    } else if (l.level === "reached") {
      warnings.push({ code: "limit-reached", severity: "warning", year: l.year, message: `You have reached the ${yearLabel} income limit — any further income is taxed at 15% and forces a switch to the general system.` });
    } else if (l.level === "90") {
      warnings.push({ code: "limit-90", severity: "warning", year: l.year, message: `Over 90% of the ${yearLabel} income limit used.` });
    } else if (l.level === "80") {
      warnings.push({ code: "limit-80", severity: "info", year: l.year, message: `Over 80% of the ${yearLabel} income limit used.` });
    }
    if (l.forcedSwitchFrom && months.some((m) => yearOf(m) === l.year && m >= monthOf(l.forcedSwitchFrom as string))) {
      warnings.push({
        code: "general-system",
        severity: "critical",
        year: l.year,
        message: `From ${formatDate(l.forcedSwitchFrom)} you must move to the general taxation system (apply by ${formatDate(l.applicationDueBy as string)}). No single tax or military levy is calculated for those months — general-system taxes are not calculated by this app.`,
      });
    }
    if (l.rulesAssumed) {
      warnings.push({
        code: "rules-assumed",
        severity: "warning",
        year: l.year,
        message: `Tax rules for ${yearLabel} are not verified yet — the last known values (minimum wage, limits) are assumed.`,
      });
    }
  }
  if (militaryMonths.length > 0) {
    warnings.push({
      code: "military-service",
      severity: "info",
      message: `No single tax or military levy is charged for ${militaryMonths.length === 1 ? formatMonth(militaryMonths[0]) : `${militaryMonths.length} selected months`} of military service (ПКУ розд. XX підр. 10 п. 25) — the income still counts towards the annual limit.`,
    });
  }
  if (beforeRegistration > 0) {
    warnings.push({
      code: "income-before-registration",
      severity: "warning",
      message: `${beforeRegistration} freelance income(s) are dated before the ФОП registration date (${formatDate(tax.fopRegisteredOn as string)}).`,
    });
  }

  return {
    months,
    rows,
    quarters: [...byQuarter.entries()].map(([period, q]) => ({ period, months: q.months, ...totalsFromAcc(q.acc) })),
    totals: totalsFromAcc(total),
    limits,
    warnings,
    rulesAssumed: years.some(isRulesAssumed),
    singleTaxRateBp: rateBp,
  };
}

// ------------------------------------------------------------------ quarterly declaration (cumulative)

export interface DeclarationQuarter {
  quarter: Quarter;
  period: QuarterKey;
  months: ISOMonth[];
  /** Income received in this quarter. */
  incomeUah: number;
  /** Cumulative from 1 January through this quarter. */
  cumulativeIncomeUah: number;
  withinCumulativeUah: number;
  excessCumulativeUah: number;
  /** Cumulative accrual, rounded once (declaration rows 12/13). */
  accruedSingleTax: number;
  /** accrued(q) − accrued(q−1) (row 14.1). */
  payableSingleTax: number;
  levyBaseCumulativeUah: number;
  accruedLevy: number;
  payableLevy: number;
  /** Σ monthly ЄСВ of the quarter. */
  esv: number;
  esvMonths: EsvMonth[];
  /** payableSingleTax + payableLevy + esv. */
  totalPayable: number;
  deadlines: QuarterDeadlines;
  /**
   * The quarter starts on/after `limit.forcedSwitchFrom` (§2.6): the ФОП is on the general system, so
   * no single tax / group 3 levy is accrued for it (its income is not added to the accruals). ЄСВ stays.
   */
  afterForcedSwitch: boolean;
  /** Months of the quarter in military service: their income accrues no single tax / levy (ПКУ розд. XX підр. 10 п. 25). */
  militaryServiceMonths: ISOMonth[];
}

export interface QuarterlyDeclaration {
  year: number;
  quarters: DeclarationQuarter[];
  totals: { incomeUah: number; singleTax: number; levy: number; esv: number; total: number };
  limit: LimitStatus;
  rulesAssumed: boolean;
  singleTaxRateBp: number;
}

export function quarterlyDeclaration(
  year: number,
  input: { incomes: readonly Income[]; settings: TaxSettingsLike; holidays?: readonly ISODate[] },
): QuarterlyDeclaration {
  const tax = taxOf(input.settings);
  const rateBp = singleTaxRateBp(tax);
  const splits = splitByLimit(input.incomes, year);
  const limit = limitStatus(input.incomes, year);
  // §2.6: from the 1st day after the crossing quarter the single-tax formulas no longer apply.
  const switchFrom = limit.forcedSwitchFrom;
  let cumIncome = 0;
  let cumWithin = 0;
  let cumExcess = 0;
  let cumLevyBase = 0;
  let stAcc = 0n;
  let levyAcc = 0n;
  let prevSt = 0;
  let prevLevy = 0;
  let esvYear = 0;
  const quarters: DeclarationQuarter[] = QUARTERS.map((q) => {
    const months = quarterMonths(year, q);
    const afterForcedSwitch = switchFrom !== null && monthStart(months[0]) >= switchFrom;
    let qIncome = 0;
    for (const s of splits) {
      if (quarterOf(s.date) !== q) continue;
      const amount = toMinor(s.amountUah);
      const within = toMinor(s.withinUah);
      const excess = toMinor(s.excessUah);
      qIncome += amount;
      cumIncome += amount;
      if (afterForcedSwitch || inMilitaryService(s.month, tax)) continue;
      cumWithin += within;
      cumExcess += excess;
      stAcc += BigInt(within) * BigInt(rateBp) + BigInt(excess) * BigInt(OVER_LIMIT_RATE_BP);
      const levyBp = militaryLevyRateBp(s.date, tax);
      if (levyBp > 0) cumLevyBase += amount;
      levyAcc += BigInt(amount) * BigInt(levyBp);
    }
    const accruedSt = roundBpAcc(stAcc);
    const accruedLevy = roundBpAcc(levyAcc);
    const esvMonths = months.map((m) => esvForMonth(m, tax));
    const esv = esvMonths.reduce((s, e) => s + toMinor(e.amount), 0);
    esvYear += esv;
    const payableSt = accruedSt - prevSt;
    const payableLevy = accruedLevy - prevLevy;
    prevSt = accruedSt;
    prevLevy = accruedLevy;
    return {
      quarter: q,
      period: quarterKey(year, q),
      months,
      incomeUah: fromMinor(qIncome),
      cumulativeIncomeUah: fromMinor(cumIncome),
      withinCumulativeUah: fromMinor(cumWithin),
      excessCumulativeUah: fromMinor(cumExcess),
      accruedSingleTax: fromMinor(accruedSt),
      payableSingleTax: fromMinor(payableSt),
      levyBaseCumulativeUah: fromMinor(cumLevyBase),
      accruedLevy: fromMinor(accruedLevy),
      payableLevy: fromMinor(payableLevy),
      esv: fromMinor(esv),
      esvMonths,
      totalPayable: fromMinor(payableSt + payableLevy + esv),
      deadlines: quarterDeadlines(year, q, input.holidays),
      afterForcedSwitch,
      militaryServiceMonths: months.filter((m) => inMilitaryService(m, tax)),
    };
  });
  return {
    year,
    quarters,
    totals: {
      incomeUah: fromMinor(cumIncome),
      singleTax: fromMinor(prevSt),
      levy: fromMinor(prevLevy),
      esv: fromMinor(esvYear),
      total: fromMinor(prevSt + prevLevy + esvYear),
    },
    limit,
    rulesAssumed: isRulesAssumed(year),
    singleTaxRateBp: rateBp,
  };
}

/** All 12 months of a year — handy "whole year" selection. */
export function wholeYear(year: number): ISOMonth[] {
  return monthsOfYear(year);
}

/** Months from January through `today`'s month (YTD) when `today` is in `year`; whole year for past years. */
export function yearToDateMonths(year: number, today: ISODate): ISOMonth[] {
  const ty = yearOf(today);
  if (year < ty) return monthsOfYear(year);
  if (year > ty) return [];
  return monthsOfYear(year).filter((m) => m <= monthOf(today));
}

// ------------------------------------------------------------------ payments vs due

export type TaxPaymentTotals = Record<QuarterKey, Record<TaxKind, number>>;

/** Σ amountUah of tax-payment expenses (those with taxMeta), by period and kind. */
export function summarizeTaxPayments(expenses: readonly Expense[]): TaxPaymentTotals {
  const minor: Record<string, Record<TaxKind, number>> = {};
  for (const e of expenses) {
    if (!e.taxMeta) continue;
    const p = (minor[e.taxMeta.period] ??= { single_tax: 0, military_levy: 0, esv: 0 });
    p[e.taxMeta.kind] += toMinor(e.amountUah);
  }
  const out: TaxPaymentTotals = {};
  for (const [period, kinds] of Object.entries(minor)) {
    out[period] = {
      single_tax: fromMinor(kinds.single_tax),
      military_levy: fromMinor(kinds.military_levy),
      esv: fromMinor(kinds.esv),
    };
  }
  return out;
}

export type PaymentState = "nothing-due" | "paid" | "partial" | "unpaid" | "overpaid";

export interface PaymentStatusItem {
  kind: TaxKind;
  due: number;
  /** Recorded for THIS quarter (Taxes expenses with this period + kind). */
  paid: number;
  /** Excess paid for earlier quarters of the same year (same kind) that covers part of this quarter's due. */
  creditApplied: number;
  /** What is left over after this quarter (passed on to the next quarters of the year; at Q4 = year-end overpayment). */
  carriedForward: number;
  /** max(0, due − creditApplied − paid). */
  outstanding: number;
  state: PaymentState;
  deadline: ISODate;
  /** today > deadline and something is still outstanding. */
  overdue: boolean;
  /** Days from today to the deadline (negative = past). */
  daysLeft: number;
}

export interface QuarterPaymentStatus {
  period: QuarterKey;
  quarter: Quarter;
  items: Record<TaxKind, PaymentStatusItem>;
  /** Σ outstanding. */
  outstanding: number;
}

/**
 * Paid vs due for every quarter of a declaration.
 * Within the year an excess is carried forward per tax kind (FIFO): an advance or overpayment
 * recorded for one quarter (e.g. a whole year of ЄСВ paid in January) covers the following
 * quarters' due before they count as outstanding / overdue. State per quarter:
 * - nothing due → "overpaid" if something was recorded for it, else "nothing-due";
 * - otherwise from what was applied (credit first, then this quarter's own payments):
 *   none → "unpaid", part → "partial", all and this quarter's own payment exceeded what was left → "overpaid", else "paid".
 */
export function declarationPaymentStatus(
  declaration: QuarterlyDeclaration,
  payments: TaxPaymentTotals,
  today: ISODate,
): QuarterPaymentStatus[] {
  const carry: Record<TaxKind, number> = { single_tax: 0, military_levy: 0, esv: 0 };
  return declaration.quarters.map((q) => {
    const paid = payments[q.period] ?? { single_tax: 0, military_levy: 0, esv: 0 };
    const item = (kind: TaxKind, due: number, deadline: ISODate): PaymentStatusItem => {
      const dueMinor = Math.max(0, toMinor(due));
      const paidMinor = Math.max(0, toMinor(paid[kind]));
      const fromCredit = Math.min(carry[kind], dueMinor);
      const left = dueMinor - fromCredit;
      const fromOwn = Math.min(paidMinor, left);
      const applied = fromCredit + fromOwn;
      carry[kind] = carry[kind] - fromCredit + (paidMinor - fromOwn);
      const outstanding = dueMinor - applied;
      const state: PaymentState =
        dueMinor === 0
          ? paidMinor > 0
            ? "overpaid"
            : "nothing-due"
          : applied === 0
            ? "unpaid"
            : applied < dueMinor
              ? "partial"
              : paidMinor > left
                ? "overpaid"
                : "paid";
      return {
        kind,
        due: fromMinor(dueMinor),
        paid: fromMinor(paidMinor),
        creditApplied: fromMinor(fromCredit),
        carriedForward: fromMinor(carry[kind]),
        outstanding: fromMinor(outstanding),
        state,
        deadline,
        overdue: outstanding > 0 && today > deadline,
        daysLeft: diffDays(today, deadline),
      };
    };
    const items: Record<TaxKind, PaymentStatusItem> = {
      single_tax: item("single_tax", q.payableSingleTax, q.deadlines.payment),
      military_levy: item("military_levy", q.payableLevy, q.deadlines.payment),
      esv: item("esv", q.esv, q.deadlines.esv),
    };
    return {
      period: q.period,
      quarter: q.quarter,
      items,
      outstanding: fromMinor(toMinor(items.single_tax.outstanding) + toMinor(items.military_levy.outstanding) + toMinor(items.esv.outstanding)),
    };
  });
}
