/**
 * Period presets for filters / analytics, previous-equivalent periods, and time buckets.
 * Pure + isomorphic. Every function takes `today` explicitly (from the server).
 */
import {
  addDays,
  addMonths,
  addMonthsToDate,
  daysInclusive,
  formatDate,
  formatDayMonth,
  formatMonth,
  isMonthEnd,
  isValidDate,
  monthEnd,
  monthOf,
  monthsBetween,
  monthStart,
  startOfWeek,
  yearOf,
  type ISODate,
  type ISOMonth,
} from "./dates";

export const PERIOD_PRESETS = [
  "this-month",
  "last-month",
  "last-3-months",
  "last-6-months",
  "this-year",
  "last-year",
  "all",
  "custom",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  "this-month": "This month",
  "last-month": "Last month",
  "last-3-months": "Last 3 months",
  "last-6-months": "Last 6 months",
  "this-year": "This year",
  "last-year": "Last year",
  all: "All time",
  custom: "Custom range",
};

export interface DateRange {
  from: ISODate;
  to: ISODate;
}

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return typeof value === "string" && (PERIOD_PRESETS as readonly string[]).includes(value);
}

/**
 * Resolve a preset to an inclusive date range.
 * - this-month:    1st of the current month .. today (month-to-date)
 * - last-month:    the whole previous calendar month
 * - last-3-months: 1st of (current month − 2) .. today  (3 calendar months incl. the current one)
 * - last-6-months: 1st of (current month − 5) .. today
 * - this-year:     1 Jan .. today
 * - last-year:     the whole previous calendar year
 * - all:           `dataRange` (earliest..latest data date, extended to today) or today..today
 * - custom:        `custom` (swapped if reversed); falls back to this-month when missing/invalid
 */
export function resolvePeriod(
  preset: PeriodPreset,
  today: ISODate,
  options: { custom?: Partial<DateRange>; dataRange?: DateRange | null } = {},
): DateRange {
  const thisMonth = monthOf(today);
  switch (preset) {
    case "this-month":
      return { from: monthStart(thisMonth), to: today };
    case "last-month": {
      const m = addMonths(thisMonth, -1);
      return { from: monthStart(m), to: monthEnd(m) };
    }
    case "last-3-months":
      return { from: monthStart(addMonths(thisMonth, -2)), to: today };
    case "last-6-months":
      return { from: monthStart(addMonths(thisMonth, -5)), to: today };
    case "this-year":
      return { from: `${yearOf(today)}-01-01`, to: today };
    case "last-year": {
      const y = yearOf(today) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case "all": {
      const r = options.dataRange;
      if (!r) return { from: today, to: today };
      return { from: r.from < today ? r.from : today, to: r.to > today ? r.to : today };
    }
    case "custom": {
      const c = options.custom;
      if (!c || !isValidDate(c.from) || !isValidDate(c.to)) return resolvePeriod("this-month", today);
      return c.from <= c.to ? { from: c.from, to: c.to } : { from: c.to, to: c.from };
    }
  }
}

/**
 * The previous equivalent period, used for "vs previous period" deltas.
 * - this-year / last-year: same span one year earlier
 *   (this-year 1 Jan..15 Oct 2026 → 1 Jan..15 Oct 2025).
 * - Month-aligned (starts on the 1st): shifted back by the number of calendar months spanned;
 *   an end on a month's last day maps to the last day of the shifted month
 *   (this-month 1..15 Oct → 1..15 Sep; last-month Sep → Aug 1..31).
 * - Otherwise (custom): the same number of days immediately before `from`.
 * - "all" has no previous period → null.
 */
export function previousPeriod(range: DateRange, preset?: PeriodPreset): DateRange | null {
  if (preset === "all") return null;
  const { from, to } = range;
  const fromDay = Number(from.slice(8, 10));
  let prev: DateRange;
  try {
    if (fromDay === 1) {
      const k =
        preset === "this-year" || preset === "last-year" ? 12 : monthsBetween(monthOf(from), monthOf(to)).length;
      const pFrom = addMonthsToDate(from, -k);
      const pTo = isMonthEnd(to) ? monthEnd(addMonths(monthOf(to), -k)) : addMonthsToDate(to, -k);
      prev = { from: pFrom, to: pTo };
    } else {
      const len = daysInclusive(from, to);
      const pTo = addDays(from, -1);
      prev = { from: addDays(pTo, -(len - 1)), to: pTo };
    }
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
  // A very long custom range (e.g. "since 1950") would start before the supported dates → no comparison.
  return isValidDate(prev.from) && isValidDate(prev.to) ? prev : null;
}

/**
 * The part of `range` that is not in the future: `to` clipped to `today` (unchanged when it already
 * ends by today). null when the whole range lies after today.
 */
export function clipToToday(range: DateRange, today: ISODate): DateRange | null {
  if (range.from > today) return null;
  return range.to > today ? { from: range.from, to: today } : range;
}

/** Days of `range` up to and including `today` (0 when it starts after today) — the divisor of daily averages. */
export function daysElapsed(range: DateRange, today: ISODate): number {
  const clipped = clipToToday(range, today);
  return clipped ? daysInclusive(clipped.from, clipped.to) : 0;
}

export type Granularity = "day" | "week" | "month";

/** ≤ 31 days → day; ≤ 120 days → week; otherwise month. */
export function granularityFor(range: DateRange): Granularity {
  const days = daysInclusive(range.from, range.to);
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

export interface TimeBucket {
  /** Stable key: the date (day), the Monday of the week (week) or YYYY-MM (month). */
  key: string;
  from: ISODate;
  to: ISODate;
  label: string;
}

/** Bucket key of a date for the given granularity. */
export function bucketKey(date: ISODate, granularity: Granularity): string {
  if (granularity === "day") return date;
  if (granularity === "week") return startOfWeek(date);
  return monthOf(date);
}

/** Every bucket covering the range (zero-fill friendly), clipped to the range. */
export function buckets(range: DateRange, granularity: Granularity): TimeBucket[] {
  const out: TimeBucket[] = [];
  if (granularity === "day") {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      out.push({ key: d, from: d, to: d, label: formatDayMonth(d) });
    }
    return out;
  }
  if (granularity === "week") {
    for (let w = startOfWeek(range.from); w <= range.to; w = addDays(w, 7)) {
      const from = w < range.from ? range.from : w;
      const end = addDays(w, 6);
      const to = end > range.to ? range.to : end;
      out.push({ key: w, from, to, label: formatDayMonth(from) });
    }
    return out;
  }
  for (const m of monthsBetween(monthOf(range.from), monthOf(range.to))) {
    const from = monthStart(m) < range.from ? range.from : monthStart(m);
    const to = monthEnd(m) > range.to ? range.to : monthEnd(m);
    out.push({ key: m, from, to, label: formatMonth(m) });
  }
  return out;
}

/** Months (YYYY-MM) touched by a range. */
export function monthsInRange(range: DateRange): ISOMonth[] {
  return monthsBetween(monthOf(range.from), monthOf(range.to));
}

/** "This month (1–15 Oct 2026)"-style label helpers. */
export function describeRange(range: DateRange): string {
  return range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`;
}

/** Search-param shape used by every period filter: ?period=<preset>&from=YYYY-MM-DD&to=YYYY-MM-DD */
export interface PeriodParams {
  preset: PeriodPreset;
  range: DateRange;
}

type SearchParamValue = string | string[] | undefined;

export function firstParam(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parse `?period=&from=&to=` into a preset + range. If `from`/`to` are present and valid
 * without `period`, the preset is "custom". Unknown values fall back to `defaultPreset`.
 */
export function parsePeriodParams(
  params: Record<string, SearchParamValue>,
  today: ISODate,
  options: { defaultPreset?: PeriodPreset; dataRange?: DateRange | null } = {},
): PeriodParams {
  const rawPreset = firstParam(params.period);
  const from = firstParam(params.from);
  const to = firstParam(params.to);
  let preset: PeriodPreset;
  if (isPeriodPreset(rawPreset)) preset = rawPreset;
  else if (isValidDate(from) && isValidDate(to)) preset = "custom";
  else preset = options.defaultPreset ?? "this-month";
  if (preset === "custom" && !(isValidDate(from) && isValidDate(to))) preset = options.defaultPreset ?? "this-month";
  const range = resolvePeriod(preset, today, { custom: { from, to }, dataRange: options.dataRange });
  return { preset, range };
}
