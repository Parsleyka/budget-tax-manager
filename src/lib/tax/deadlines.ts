/**
 * Filing / payment deadlines (research/tax-rules.md §3).
 * filing  = nextBusinessDay(quarterEnd + 40 days)
 * payment = nextBusinessDay(quarterEnd + 50 days)   — counted from the UNSHIFTED 40th day
 * ЄСВ     = nextBusinessDay(19th of the month after the quarter)
 * Holidays default to none (martial law: public holidays are working days).
 * Pure + isomorphic.
 */
import {
  addDays,
  diffDays,
  formatQuarter,
  isWeekend,
  makeDate,
  quarterEnd,
  quarterKey,
  QUARTERS,
  yearOf,
  type ISODate,
  type Quarter,
  type QuarterKey,
} from "../dates";

export const DEFAULT_HOLIDAYS: readonly ISODate[] = [];

export function isBusinessDay(date: ISODate, holidays: readonly ISODate[] = DEFAULT_HOLIDAYS): boolean {
  return !isWeekend(date) && !holidays.includes(date);
}

/** `date` itself if it is a business day, otherwise the next one. */
export function nextBusinessDay(date: ISODate, holidays: readonly ISODate[] = DEFAULT_HOLIDAYS): ISODate {
  let d = date;
  while (!isBusinessDay(d, holidays)) d = addDays(d, 1);
  return d;
}

/** The unshifted 40th day after the quarter end. */
export function fortiethDay(year: number, quarter: Quarter): ISODate {
  return addDays(quarterEnd(year, quarter), 40);
}

export function filingDeadline(year: number, quarter: Quarter, holidays: readonly ISODate[] = DEFAULT_HOLIDAYS): ISODate {
  return nextBusinessDay(fortiethDay(year, quarter), holidays);
}

/** Single tax + military levy payment deadline (10 days after the UNSHIFTED 40th day). */
export function paymentDeadline(year: number, quarter: Quarter, holidays: readonly ISODate[] = DEFAULT_HOLIDAYS): ISODate {
  return nextBusinessDay(addDays(fortiethDay(year, quarter), 10), holidays);
}

/** Own ЄСВ for the quarter: the 19th of the month after the quarter (shifted to a business day). */
export function esvDeadline(year: number, quarter: Quarter, holidays: readonly ISODate[] = DEFAULT_HOLIDAYS): ISODate {
  const after = addDays(quarterEnd(year, quarter), 1);
  return nextBusinessDay(makeDate(yearOf(after), Number(after.slice(5, 7)), 19), holidays);
}

export interface QuarterDeadlines {
  period: QuarterKey;
  fortiethDay: ISODate;
  filing: ISODate;
  payment: ISODate;
  esv: ISODate;
}

export function quarterDeadlines(year: number, quarter: Quarter, holidays: readonly ISODate[] = DEFAULT_HOLIDAYS): QuarterDeadlines {
  return {
    period: quarterKey(year, quarter),
    fortiethDay: fortiethDay(year, quarter),
    filing: filingDeadline(year, quarter, holidays),
    payment: paymentDeadline(year, quarter, holidays),
    esv: esvDeadline(year, quarter, holidays),
  };
}

export type DeadlineKind = "filing" | "payment" | "esv";

export const DEADLINE_KIND_LABELS: Record<DeadlineKind, string> = {
  filing: "File declaration",
  payment: "Pay single tax + military levy",
  esv: "Pay ЄСВ",
};

export interface TaxDeadline {
  kind: DeadlineKind;
  period: QuarterKey;
  year: number;
  quarter: Quarter;
  date: ISODate;
  /** e.g. "File declaration — Q3 2026" (Q4 = annual declaration). */
  label: string;
  /** Days from `today` (negative = past). Only set by upcomingDeadlines(). */
  daysLeft?: number;
}

/** All deadlines FOR the quarters of `year` (Q4's fall in the next calendar year). */
export function deadlinesForYear(year: number, holidays: readonly ISODate[] = DEFAULT_HOLIDAYS): TaxDeadline[] {
  const out: TaxDeadline[] = [];
  for (const q of QUARTERS) {
    const d = quarterDeadlines(year, q, holidays);
    const periodLabel = q === 4 ? `${formatQuarter(d.period)} (annual)` : formatQuarter(d.period);
    out.push({ kind: "filing", period: d.period, year, quarter: q, date: d.filing, label: `${DEADLINE_KIND_LABELS.filing} — ${periodLabel}` });
    out.push({ kind: "payment", period: d.period, year, quarter: q, date: d.payment, label: `${DEADLINE_KIND_LABELS.payment} — ${periodLabel}` });
    out.push({ kind: "esv", period: d.period, year, quarter: q, date: d.esv, label: `${DEADLINE_KIND_LABELS.esv} — ${periodLabel}` });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** Deadlines on or after `today` (sorted), with daysLeft. Default: the next 6. */
export function upcomingDeadlines(
  today: ISODate,
  options: { count?: number; holidays?: readonly ISODate[] } = {},
): TaxDeadline[] {
  const y = yearOf(today);
  const all = [y - 1, y, y + 1].flatMap((year) => deadlinesForYear(year, options.holidays));
  return all
    .filter((d) => d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, options.count ?? 6)
    .map((d) => ({ ...d, daysLeft: diffDays(today, d.date) }));
}
