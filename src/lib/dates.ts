/**
 * Calendar-date helpers. Dates are `YYYY-MM-DD` strings, months `YYYY-MM`, quarters
 * `YYYY-Qn`. All arithmetic is done on UTC midnights, so results never depend on the
 * machine's time zone. "Today" is always the Europe/Kyiv calendar date.
 *
 * Pure + isomorphic. NOTE: never call `todayKyiv()` during render of a client component
 * (Next 16 fails the build on `new Date()` there) — compute it on the server and pass it down.
 */

export type ISODate = string; // YYYY-MM-DD
export type ISOMonth = string; // YYYY-MM
export type QuarterKey = string; // YYYY-Qn
export type Quarter = 1 | 2 | 3 | 4;

export const KYIV_TZ = "Europe/Kyiv";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

// ------------------------------------------------------------------ today / now

const kyivDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KYIV_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Europe/Kyiv calendar date of `now` (default: the current instant). */
export function todayKyiv(now: Date = new Date()): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return kyivDateFormatter.format(now);
}

/** ISO timestamp for createdAt/updatedAt. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

// ------------------------------------------------------------------ validation / parsing

export function isValidDate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isValidMonth(value: unknown): value is ISOMonth {
  if (typeof value !== "string") return false;
  const m = MONTH_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return y >= 1900 && y <= 2999 && mo >= 1 && mo <= 12;
}

export function isValidQuarterKey(value: unknown): value is QuarterKey {
  return typeof value === "string" && QUARTER_RE.test(value) && Number(value.slice(0, 4)) >= 1900;
}

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number;
}

export function parseDate(date: ISODate): DateParts {
  if (!isValidDate(date)) throw new RangeError(`Invalid date: ${date}`);
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

export function makeDate(year: number, month: number, day: number): ISODate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function makeMonth(year: number, month: number): ISOMonth {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtc(date: ISODate): number {
  const { year, month, day } = parseDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): ISODate {
  const d = new Date(ms);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

// ------------------------------------------------------------------ arithmetic

const DAY_MS = 86_400_000;

export function addDays(date: ISODate, days: number): ISODate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (b − a). diffDays("2026-10-01","2026-10-15") === 14. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Inclusive day count of a range. */
export function daysInclusive(from: ISODate, to: ISODate): number {
  return diffDays(from, to) + 1;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: ISODate): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function isWeekend(date: ISODate): boolean {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function isDateInRange(date: ISODate, from: ISODate, to: ISODate): boolean {
  return date >= from && date <= to;
}

/** Every date from..to inclusive. */
export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the ISO week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

// ------------------------------------------------------------------ months

export function yearOf(date: ISODate | ISOMonth): number {
  return Number(date.slice(0, 4));
}

/** "2026-10-15" → "2026-10". */
export function monthOf(date: ISODate): ISOMonth {
  return date.slice(0, 7);
}

/** 1..12 for a date or month string. */
export function monthNumber(dateOrMonth: string): number {
  return Number(dateOrMonth.slice(5, 7));
}

export function monthStart(month: ISOMonth): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: ISOMonth): ISODate {
  const y = yearOf(month);
  const m = monthNumber(month);
  return makeDate(y, m, daysInMonth(y, m));
}

export function addMonths(month: ISOMonth, n: number): ISOMonth {
  const y = yearOf(month);
  const m = monthNumber(month) - 1 + n;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return makeMonth(ny, nm + 1);
}

/** Shift a date by n months, clamping the day to the target month's length. */
export function addMonthsToDate(date: ISODate, n: number): ISODate {
  const { day } = parseDate(date);
  const target = addMonths(monthOf(date), n);
  const y = yearOf(target);
  const m = monthNumber(target);
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Inclusive list of months from..to ("2026-01".."2026-03" → 3 items). */
export function monthsBetween(from: ISOMonth, to: ISOMonth): ISOMonth[] {
  const out: ISOMonth[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** All 12 months of a year. */
export function monthsOfYear(year: number): ISOMonth[] {
  return Array.from({ length: 12 }, (_, i) => makeMonth(year, i + 1));
}

export function isMonthEnd(date: ISODate): boolean {
  return date === monthEnd(monthOf(date));
}

export function yearStart(year: number): ISODate {
  return makeDate(year, 1, 1);
}

export function yearEnd(year: number): ISODate {
  return makeDate(year, 12, 31);
}

// ------------------------------------------------------------------ quarters

/** Quarter (1..4) of a date or month string. */
export function quarterOf(dateOrMonth: string): Quarter {
  return (Math.floor((monthNumber(dateOrMonth) - 1) / 3) + 1) as Quarter;
}

export function quarterKey(year: number, quarter: Quarter): QuarterKey {
  return `${year}-Q${quarter}`;
}

/** Quarter key of a date or month: "2026-10-15" → "2026-Q4". */
export function quarterKeyOf(dateOrMonth: string): QuarterKey {
  return quarterKey(yearOf(dateOrMonth), quarterOf(dateOrMonth));
}

export function parseQuarterKey(key: QuarterKey): { year: number; quarter: Quarter } {
  const m = QUARTER_RE.exec(key);
  if (!m) throw new RangeError(`Invalid quarter key: ${key}`);
  return { year: Number(m[1]), quarter: Number(m[2]) as Quarter };
}

export function quarterMonths(year: number, quarter: Quarter): ISOMonth[] {
  const first = (quarter - 1) * 3 + 1;
  return [makeMonth(year, first), makeMonth(year, first + 1), makeMonth(year, first + 2)];
}

export function quarterStart(year: number, quarter: Quarter): ISODate {
  return makeDate(year, (quarter - 1) * 3 + 1, 1);
}

export function quarterEnd(year: number, quarter: Quarter): ISODate {
  return monthEnd(makeMonth(year, quarter * 3));
}

export const QUARTERS: readonly Quarter[] = [1, 2, 3, 4];

// ------------------------------------------------------------------ NBU format bridges

/** "2026-10-15" → "20261015" (NBU `date=` parameter). */
export function toNbuDate(date: ISODate): string {
  if (!isValidDate(date)) throw new RangeError(`Invalid date: ${date}`);
  return date.replaceAll("-", "");
}

/** "15.10.2026" → "2026-10-15"; null when malformed. */
export function fromNbuDate(value: string): ISODate | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isValidDate(iso) ? iso : null;
}

// ------------------------------------------------------------------ display

/** "2026-10-15" → "15 Oct 2026". */
export function formatDate(date: ISODate): string {
  const { year, month, day } = parseDate(date);
  return `${day} ${MONTH_SHORT[month - 1]} ${year}`;
}

/** "2026-10-15" → "15.10.2026". */
export function formatDateNumeric(date: ISODate): string {
  const { year, month, day } = parseDate(date);
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

/** "2026-10-15" → "15 Oct" (no year). */
export function formatDayMonth(date: ISODate): string {
  const { month, day } = parseDate(date);
  return `${day} ${MONTH_SHORT[month - 1]}`;
}

/** "2026-10-15" → "Thu". */
export function formatWeekday(date: ISODate): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dayOfWeek(date)];
}

/** "2026-10" → "Oct 2026" (or "October 2026" with long=true). */
export function formatMonth(month: ISOMonth, long = false): string {
  const m = monthNumber(month);
  return `${(long ? MONTH_LONG : MONTH_SHORT)[m - 1]} ${yearOf(month)}`;
}

/** 10 → "Oct" / "October". */
export function monthName(monthNum: number, long = false): string {
  return (long ? MONTH_LONG : MONTH_SHORT)[monthNum - 1];
}

/** "2026-Q4" → "Q4 2026". */
export function formatQuarter(key: QuarterKey): string {
  const { year, quarter } = parseQuarterKey(key);
  return `Q${quarter} ${year}`;
}

/** Inclusive range label: "1–15 Oct 2026", "28 Sep – 4 Oct 2026", "1 Dec 2025 – 15 Jan 2026". */
export function formatDateRange(from: ISODate, to: ISODate): string {
  if (from === to) return formatDate(from);
  const a = parseDate(from);
  const b = parseDate(to);
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`;
  if (a.year === b.year) return `${a.day} ${MONTH_SHORT[a.month - 1]} – ${b.day} ${MONTH_SHORT[b.month - 1]} ${b.year}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}

/** Convert a JS Date picked in a calendar (local midnight) to YYYY-MM-DD using its LOCAL parts. */
export function dateFromLocalDate(d: Date): ISODate {
  return makeDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** YYYY-MM-DD → JS Date at LOCAL midnight (for react-day-picker `selected`). */
export function localDateFromDate(date: ISODate): Date {
  const { year, month, day } = parseDate(date);
  return new Date(year, month - 1, day);
}
