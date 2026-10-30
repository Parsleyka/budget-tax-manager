/**
 * Versioned ФОП group 3 parameter tables (research/tax-rules.md §1). All rates in basis points.
 * For years outside the table the last (or first) known values are reused and callers must
 * flag `rulesAssumed: true` so the UI can warn. Pure + isomorphic.
 */
import { fromMinor, percentOf, pctToBp, toMinor } from "../money";
import { yearOf, type ISODate, type ISOMonth } from "../dates";
import type { TaxSettings } from "../types";

/** Minimum wage (МЗП) schedule, month-granular: the entry with the latest `from` ≤ month applies. */
export const MIN_WAGE_SCHEDULE: readonly { from: ISOMonth; amount: number; source: string }[] = [
  { from: "2024-01", amount: 7100, source: "Law 3460-IX art. 8" },
  { from: "2024-04", amount: 8000, source: "Law 3460-IX art. 8" },
  { from: "2025-01", amount: 8000, source: "Law 4059-IX art. 8" },
  { from: "2026-01", amount: 8647, source: "Law 4695-IX art. 8" },
];

export const FIRST_RULES_YEAR = 2024;
export const LAST_KNOWN_RULES_YEAR = 2026;

/** ЄСВ rate: 22% of the base (Law 2464-VI art. 8 ч. 5). */
export const ESV_RATE_BP = 2200;

/** Maximum ЄСВ base = multiplier × МЗП of the month. */
export const MAX_BASE_MULTIPLIER: Readonly<Record<number, number>> = { 2024: 15, 2025: 20, 2026: 20 };

/** Annual income limit = 1167 × МЗП set on 1 January (ПКУ п. 291.4 пп. 3). */
export const INCOME_LIMIT_MULTIPLIER = 1167;

export const SINGLE_TAX_RATE_BP = 500; // 5%, non-VAT payer
export const SINGLE_TAX_RATE_VAT_BP = 300; // 3%, VAT payer (amounts exclude VAT)
export const OVER_LIMIT_RATE_BP = 1500; // 15% on the excess over the limit

/** Military levy for group 3: 0 before 2025-01-01, 1% from then (open-ended end date). */
export const MILITARY_LEVY_START: ISODate = "2025-01-01";
export const MILITARY_LEVY_RATE_BP = 100;

/** Limit progress warning thresholds (fractions). */
export const LIMIT_WARNING_THRESHOLDS = [0.8, 0.9, 1] as const;

/** Year outside the verified tables → values are assumed (last/first known reused). */
export function isRulesAssumed(year: number): boolean {
  return year > LAST_KNOWN_RULES_YEAR || year < FIRST_RULES_YEAR;
}

/** МЗП in force in `month` (YYYY-MM). Months before the table use the first entry (assumed). */
export function minimumWage(month: ISOMonth): number {
  let amount = MIN_WAGE_SCHEDULE[0].amount;
  for (const e of MIN_WAGE_SCHEDULE) if (e.from <= month) amount = e.amount;
  return amount;
}

/** Minimum monthly ЄСВ = 22% × МЗП(month), HALF-UP. 2026 → 1 902.34. */
export function minimumEsv(month: ISOMonth): number {
  return percentOf(minimumWage(month), ESV_RATE_BP);
}

export function maxBaseMultiplier(year: number): number {
  if (MAX_BASE_MULTIPLIER[year] !== undefined) return MAX_BASE_MULTIPLIER[year];
  return year > LAST_KNOWN_RULES_YEAR
    ? MAX_BASE_MULTIPLIER[LAST_KNOWN_RULES_YEAR]
    : MAX_BASE_MULTIPLIER[FIRST_RULES_YEAR];
}

/** Maximum ЄСВ base for a month = multiplier(year) × МЗП(month). */
export function maxEsvBase(month: ISOMonth): number {
  return fromMinor(toMinor(minimumWage(month)) * maxBaseMultiplier(yearOf(month)));
}

/** Maximum monthly ЄСВ = 22% × max base. */
export function maximumEsv(month: ISOMonth): number {
  return percentOf(maxEsvBase(month), ESV_RATE_BP);
}

/** Annual income limit = 1167 × МЗП on 1 January. 2026 → 10 091 049.00. */
export function incomeLimit(year: number): number {
  return fromMinor(toMinor(minimumWage(`${year}-01`)) * INCOME_LIMIT_MULTIPLIER);
}

/** Single tax base rate in bp: override → else 3% (VAT payer) / 5%. */
export function singleTaxRateBp(tax: Pick<TaxSettings, "vatPayer" | "singleTaxRateOverridePct">): number {
  if (tax.singleTaxRateOverridePct !== null) return pctToBp(tax.singleTaxRateOverridePct);
  return tax.vatPayer ? SINGLE_TAX_RATE_VAT_BP : SINGLE_TAX_RATE_BP;
}

/** Whether income received on `date` is inside the military levy window. */
export function isInLevyWindow(
  date: ISODate,
  tax: Pick<TaxSettings, "militaryLevyEnabled" | "militaryLevyEndDate">,
): boolean {
  if (!tax.militaryLevyEnabled) return false;
  if (date < MILITARY_LEVY_START) return false;
  return !(tax.militaryLevyEndDate !== null && date > tax.militaryLevyEndDate);
}

/** Military levy rate (bp) for income received on `date`: 0 outside the window. */
export function militaryLevyRateBp(
  date: ISODate,
  tax: Pick<TaxSettings, "militaryLevyEnabled" | "militaryLevyEndDate" | "militaryLevyRateOverridePct">,
): number {
  if (!isInLevyWindow(date, tax)) return 0;
  return tax.militaryLevyRateOverridePct !== null ? pctToBp(tax.militaryLevyRateOverridePct) : MILITARY_LEVY_RATE_BP;
}

/** Read-only rule tables for display (Settings page). */
export interface RulesTable {
  minimumWage: { from: ISOMonth; amount: number; minimumEsv: number; maxBase: number; maximumEsv: number; source: string }[];
  limits: { year: number; minimumWageJan1: number; limit: number }[];
  maxBaseMultiplier: { year: number; multiplier: number }[];
  rates: {
    singleTaxPct: number;
    singleTaxVatPct: number;
    overLimitPct: number;
    esvPct: number;
    militaryLevyPct: number;
    militaryLevyStart: ISODate;
    limitMultiplier: number;
  };
  firstYear: number;
  lastKnownYear: number;
}

export function rulesTable(): RulesTable {
  const years: number[] = [];
  for (let y = FIRST_RULES_YEAR; y <= LAST_KNOWN_RULES_YEAR; y++) years.push(y);
  return {
    minimumWage: MIN_WAGE_SCHEDULE.map((e) => ({
      from: e.from,
      amount: e.amount,
      minimumEsv: minimumEsv(e.from),
      maxBase: maxEsvBase(e.from),
      maximumEsv: maximumEsv(e.from),
      source: e.source,
    })),
    limits: years.map((year) => ({ year, minimumWageJan1: minimumWage(`${year}-01`), limit: incomeLimit(year) })),
    maxBaseMultiplier: years.map((year) => ({ year, multiplier: maxBaseMultiplier(year) })),
    rates: {
      singleTaxPct: SINGLE_TAX_RATE_BP / 100,
      singleTaxVatPct: SINGLE_TAX_RATE_VAT_BP / 100,
      overLimitPct: OVER_LIMIT_RATE_BP / 100,
      esvPct: ESV_RATE_BP / 100,
      militaryLevyPct: MILITARY_LEVY_RATE_BP / 100,
      militaryLevyStart: MILITARY_LEVY_START,
      limitMultiplier: INCOME_LIMIT_MULTIPLIER,
    },
    firstYear: FIRST_RULES_YEAR,
    lastKnownYear: LAST_KNOWN_RULES_YEAR,
  };
}
