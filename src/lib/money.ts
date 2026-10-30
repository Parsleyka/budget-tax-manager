/**
 * Money helpers. Amounts are stored as JS numbers in MAJOR units with at most 2 decimals
 * (e.g. 1234.56), but every piece of arithmetic goes through integer MINOR units
 * (kopecks / cents) so there is no float accumulation anywhere.
 *
 * Rounding is HALF-UP, symmetric (away from zero for negatives) — the app convention
 * from research/tax-rules.md §5.12.
 *
 * Pure + isomorphic: safe to import from client components.
 */

export type Currency = "UAH" | "USD" | "EUR" | "PLN";

/** Every supported currency, in display order (UAH first, then the foreign ones with NBU rates). */
export const CURRENCIES = ["UAH", "USD", "EUR", "PLN"] as const satisfies readonly Currency[];
export const FOREIGN_CURRENCIES = ["USD", "EUR", "PLN"] as const satisfies readonly Currency[];

/** Exchange rates carry at most 4 decimals; they are scaled by this factor for exact math. */
export const RATE_SCALE = 10_000;
/** Basis points: 1% = 100 bp, 100% = 10 000 bp. */
export const BP_SCALE = 10_000;

/** Integer division rounded HALF-UP, away from zero (exact, bigint). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** True when `value` is finite and has at most `decimals` decimal places. */
export function hasAtMostDecimals(value: number, decimals: number): boolean {
  if (!Number.isFinite(value)) return false;
  // The shortest decimal representation of `value` must survive a round-trip through toFixed.
  return Number(value.toFixed(decimals)) === value;
}

/** Scale a decimal number to an integer with `decimals` places. Throws on excess precision. */
function scaleExact(value: number, decimals: number, what: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${what} must be a finite number`);
  if (!hasAtMostDecimals(value, decimals)) {
    throw new RangeError(`${what} must have at most ${decimals} decimals (got ${value})`);
  }
  const abs = Math.round(Math.abs(value) * 10 ** decimals);
  if (!Number.isSafeInteger(abs)) throw new RangeError(`${what} is too large`);
  return value < 0 ? -abs : abs;
}

/** 1234.56 → 123456. Throws if the amount has more than 2 decimals or is not finite. */
export function toMinor(amount: number): number {
  return scaleExact(amount, 2, "Amount");
}

/** 123456 → 1234.56. */
export function fromMinor(minor: number): number {
  if (!Number.isSafeInteger(minor)) throw new RangeError(`Minor amount must be a safe integer (got ${minor})`);
  const v = minor / 100;
  return Object.is(v, -0) ? 0 : v;
}

/** Rate (≤ 4 decimals) → integer scaled by 1e4. 44.9801 → 449801. */
export function rateToScaled(rate: number): number {
  return scaleExact(rate, 4, "Rate");
}

/** Round an arbitrary float to 2 decimals (HALF-UP). Only for display-derived values, never sums. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Value must be finite");
  const sign = value < 0 ? -1 : 1;
  // Use exponential notation to dodge binary representation issues (1.005 → 1.01).
  const shifted = Number(`${Math.abs(value)}e2`);
  const r = Math.round(shifted);
  const v = (sign * r) / 100;
  return Object.is(v, -0) ? 0 : v;
}

/** Round an arbitrary float to 4 decimals (HALF-UP). Used for effective exchange rates. */
export function round4(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError("Value must be finite");
  const sign = value < 0 ? -1 : 1;
  const r = Math.round(Number(`${Math.abs(value)}e4`));
  const v = (sign * r) / 10_000;
  return Object.is(v, -0) ? 0 : v;
}

/** Exact sum of major amounts (via minor units). */
export function sumMoney(amounts: readonly number[]): number {
  let total = 0;
  for (const a of amounts) total += toMinor(a);
  return fromMinor(total);
}

export function addMoney(a: number, b: number): number {
  return fromMinor(toMinor(a) + toMinor(b));
}

export function subtractMoney(a: number, b: number): number {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** amount (minor) × rate → UAH minor, HALF-UP. */
export function convertMinorToUah(amountMinor: number, rate: number): number {
  const result = divRoundHalfUp(BigInt(amountMinor) * BigInt(rateToScaled(rate)), BigInt(RATE_SCALE));
  return Number(result);
}

/**
 * Convert a major amount to UAH at `rate` (UAH per 1 unit), HALF-UP to kopecks.
 * convertToUah(1234.56, 44.9801) === 55530.63
 */
export function convertToUah(amount: number, rate: number): number {
  return fromMinor(convertMinorToUah(toMinor(amount), rate));
}

/**
 * A UAH amount expressed in another currency at `rate` (UAH per 1 unit), HALF-UP to cents — for
 * display only (e.g. the Overview "Show in $" switch). convertFromUah(41500, 41.5) === 1000
 */
export function convertFromUah(amountUah: number, rate: number): number {
  const minor = divRoundHalfUp(BigInt(toMinor(amountUah)) * BigInt(RATE_SCALE), BigInt(rateToScaled(rate)));
  return fromMinor(Number(minor));
}

/** Percentage of a minor amount in basis points, HALF-UP away from zero. 5% = 500 bp. */
export function percentOfMinor(amountMinor: number, basisPoints: number): number {
  if (!Number.isSafeInteger(basisPoints)) throw new RangeError("Basis points must be an integer");
  return Number(divRoundHalfUp(BigInt(amountMinor) * BigInt(basisPoints), BigInt(BP_SCALE)));
}

/** Percentage of a major amount in basis points. percentOf(8000, 2200) === 1760. */
export function percentOf(amount: number, basisPoints: number): number {
  return fromMinor(percentOfMinor(toMinor(amount), basisPoints));
}

/** Percent (≤ 2 decimals, e.g. 5 or 1.5) → basis points (500, 150). */
export function pctToBp(pct: number): number {
  return scaleExact(pct, 2, "Percent");
}

/** Basis points → percent number (500 → 5). */
export function bpToPct(bp: number): number {
  return bp / 100;
}

/** Effective exchange rate of a conversion (UAH per unit), rounded to 4 decimals. */
export function effectiveRate(fromAmount: number, toAmount: number): number {
  const from = toMinor(fromAmount);
  if (from === 0) throw new RangeError("fromAmount must not be 0");
  const scaled = divRoundHalfUp(BigInt(toMinor(toAmount)) * BigInt(RATE_SCALE), BigInt(from));
  return Number(scaled) / RATE_SCALE;
}

/** Ratio a/b as a plain number (for percentages / shares). Returns null when b is 0. */
export function ratio(a: number, b: number): number | null {
  const bm = toMinor(b);
  if (bm === 0) return null;
  return toMinor(a) / bm;
}

const cmpBig = (a: bigint, b: bigint): number => (a > b ? 1 : a < b ? -1 : 0);

/**
 * Split `units` (a non-negative integer) in proportion to integer `weights` with the largest-remainder
 * (Hamilton) method: every part is an integer and the parts add up to exactly `units`. Weights ≤ 0 get 0;
 * when no weight is positive every part is 0. Ties go to the larger weight, then to the earlier entry.
 */
export function apportion(weights: readonly number[], units: number): number[] {
  if (!Number.isSafeInteger(units) || units < 0) throw new RangeError(`Units must be a non-negative integer (got ${units})`);
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x)) throw new RangeError(`Weights must be safe integers (got ${x})`);
    return x > 0 ? BigInt(x) : 0n;
  });
  const total = w.reduce((s, x) => s + x, 0n);
  if (total === 0n) return weights.map(() => 0);
  const u = BigInt(units);
  const parts = w.map((x) => (x * u) / total);
  const rest = w.map((x) => (x * u) % total);
  // Σ remainders / total < number of positive weights, so one pass hands out every unit left.
  let left = units - Number(parts.reduce((s, x) => s + x, 0n));
  const order = w
    .map((_, i) => i)
    .filter((i) => w[i] > 0n)
    .sort((a, b) => cmpBig(rest[b], rest[a]) || cmpBig(w[b], w[a]) || a - b);
  for (const i of order) {
    if (left <= 0) break;
    parts[i] += 1n;
    left -= 1;
  }
  return parts.map(Number);
}

/** 100 % expressed in display units of `fractionDigits` decimals of a percent (1 → 1 000 = 100,0 %). */
export function percentUnits(fractionDigits = 1): number {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) {
    throw new RangeError(`fractionDigits must be an integer 0..4 (got ${fractionDigits})`);
  }
  return 100 * 10 ** fractionDigits;
}

/**
 * Display shares (fractions 0..1) of the positive `amounts` (major units), rounded to `fractionDigits`
 * decimals of a percent with the largest-remainder method — so the shares shown with
 * `formatPercent(share, fractionDigits)` add up to exactly 100 % (never 99,9 % or 100,1 %).
 * Amounts ≤ 0 get 0; all 0 when nothing is positive. Keep the exact ratio for bar widths and math.
 */
export function roundedShares(amounts: readonly number[], fractionDigits = 1): number[] {
  const units = percentUnits(fractionDigits);
  return apportion(amounts.map((a) => Math.max(0, toMinor(a))), units).map((p) => p / units);
}

export function isPositiveMoney(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0 && hasAtMostDecimals(amount, 2);
}

/**
 * Parse user input like "1 234,56", "1234.56", "1,234.56" → 1234.56.
 * Returns null for empty / invalid input or more than 2 decimals — counted on the TYPED text, so
 * "58.500" / "58,500" (a thousands separator, i.e. 58 500) is refused instead of silently becoming 58.5.
 */
export function parseMoneyInput(input: string): number | null {
  const n = parseDecimalInput(input, 2);
  if (n === null || !hasAtMostDecimals(n, 2)) return null;
  return n;
}

/** Parse a rate typed by the user ("44,9801") → 44.9801; null when invalid or > 4 decimals. */
export function parseRateInput(input: string): number | null {
  const n = parseDecimalInput(input);
  if (n === null || n <= 0 || !hasAtMostDecimals(n, 4)) return null;
  return n;
}

// ---------------------------------------------------------------------------------------
// Amount inputs: digit grouping while typing ("100000" → "100 000").
// ---------------------------------------------------------------------------------------

/** Group separator used in input fields (a plain space — easy to type and to copy). */
export const INPUT_GROUP_SEPARATOR = " ";

const WHITESPACE = /[\s  ]/g;

/** "1234567" → "1 234 567" (digits only). */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, INPUT_GROUP_SEPARATOR);
}

/**
 * Format an amount field's text as the user types: the integer part is grouped by thousands with
 * spaces ("100000" → "100 000", "1234567,5" → "1 234 567,5", "1 0000" → "10 000"). The decimal
 * separator (comma or dot) and the decimals are kept exactly as typed, so ambiguous input such as
 * "58.500" still reaches `parseMoneyInput` unchanged and is rejected there. Anything that is not a
 * plain number (letters, two separators, "1.234,56"…) is returned untouched for validation to report.
 */
export function formatAmountTyping(text: string): string {
  const compact = text.replace(WHITESPACE, "");
  const m = /^(-?)(\d*)([.,]\d*)?$/.exec(compact);
  if (!m) return text;
  return `${m[1]}${groupThousands(m[2])}${m[3] ?? ""}`;
}

/** Characters that carry meaning (everything except spaces) before `index`. */
function significantBefore(text: string, index: number): number {
  return text.slice(0, index).replace(WHITESPACE, "").length;
}

/** Position in `text` just after its `n`-th significant (non-space) character. */
function indexAfterSignificant(text: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!/[\s  ]/.test(text[i])) seen += 1;
    if (seen === n) return i + 1;
  }
  return text.length;
}

/**
 * One edit of a grouped amount field. `prev` is the field's text before the edit, `raw` the browser's
 * text after it, `caret` the caret in `raw`, `inputType` the InputEvent's type. Returns the regrouped
 * text and where the caret belongs, so it stays next to the same digit. Deleting a group space with
 * Backspace / Delete removes the neighbouring digit instead (the space would just come back).
 */
export function amountInputEdit(prev: string, raw: string, caret: number, inputType?: string): { text: string; caret: number } {
  let text = raw;
  let at = caret;
  const onlySpaceRemoved =
    raw.length === prev.length - 1 && raw.replace(WHITESPACE, "") === prev.replace(WHITESPACE, "") && prev !== raw;
  if (onlySpaceRemoved && inputType === "deleteContentBackward" && at > 0) {
    text = raw.slice(0, at - 1) + raw.slice(at);
    at -= 1;
  } else if (onlySpaceRemoved && inputType === "deleteContentForward" && at < raw.length) {
    text = raw.slice(0, at) + raw.slice(at + 1);
  }
  const formatted = formatAmountTyping(text);
  if (formatted === text) return { text, caret: at };
  return { text: formatted, caret: indexAfterSignificant(formatted, significantBefore(text, at)) };
}

/** `maxTypedDecimals`: refuse input whose typed fractional part is longer (trailing zeros included). */
function parseDecimalInput(input: string, maxTypedDecimals = Infinity): number | null {
  let s = input.trim().replace(/[\s  ']/g, "");
  if (s === "") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const fraction = s.split(".")[1];
  if (fraction !== undefined && fraction.length > maxTypedDecimals) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------------------
// Formatting (uk-UA locale, narrow symbols: "41 230,50 ₴", "1 000,00 $", "950,00 €").
// Intl output uses U+00A0 (no-break space) between groups and before the symbol.
// ---------------------------------------------------------------------------------------

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export interface FormatMoneyOptions {
  /** "exceptZero" renders +/− for deltas. Default "auto". */
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
  /** Drop kopecks (e.g. for chart axes). Default false. */
  noDecimals?: boolean;
  /** Compact notation for axis ticks: "41,2K ₴", "1,5M ₴" (uk-UA digits, English K/M/B suffixes). Default false. */
  compact?: boolean;
}

/** uk-UA compact suffixes → the English ones used in this English-language UI. */
const COMPACT_SUFFIXES: Record<string, string> = { "тис.": "K", млн: "M", млрд: "B", трлн: "T" };

export function formatMoney(amount: number, currency: Currency, options: FormatMoneyOptions = {}): string {
  const key = `${currency}|${options.signDisplay ?? "auto"}|${options.noDecimals ? 0 : 2}|${options.compact ? 1 : 0}`;
  let fmt = moneyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat("uk-UA", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      signDisplay: options.signDisplay ?? "auto",
      notation: options.compact ? "compact" : "standard",
      minimumFractionDigits: options.noDecimals || options.compact ? 0 : 2,
      maximumFractionDigits: options.noDecimals ? 0 : options.compact ? 1 : 2,
    });
    moneyFormatters.set(key, fmt);
  }
  if (!options.compact) return fmt.format(amount);
  // "41,2 тис. ₴" → "41,2K ₴": swap the suffix and drop the space before it.
  const parts = fmt.formatToParts(amount);
  return parts
    .map((p, i) => {
      if (p.type === "literal" && parts[i + 1]?.type === "compact") return "";
      return p.type === "compact" ? (COMPACT_SUFFIXES[p.value] ?? p.value) : p.value;
    })
    .join("");
}

/** Plain number with uk-UA grouping and exactly 2 decimals, no symbol: "41 230,50". */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

/** NBU-style rate with 4 decimals: 44.9801 → "44,9801". */
export function formatRate(rate: number, decimals = 4): string {
  return new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rate);
}

/** 0.1234 → "12,3%" (uk-UA). `value` is a fraction (0..1), not a percent. */
export function formatPercent(value: number, fractionDigits = 1): string {
  return new Intl.NumberFormat("uk-UA", {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export const CURRENCY_SYMBOL: Record<Currency, string> = { UAH: "₴", USD: "$", EUR: "€", PLN: "zł" };
