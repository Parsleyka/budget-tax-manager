import "server-only";
import { addDays, isValidDate, nowIso, todayKyiv, type ISODate } from "@/lib/dates";
import { round4 } from "@/lib/money";
import type { Currency, ForeignCurrency, RatesCache } from "@/lib/types";
import { readRatesCache, updateRatesCache } from "../db/store";
import { fetchNbuDay, fetchNbuRange, isNbuCurrency, NBU_CURRENCIES, NbuError, type NbuDayRow, type NbuFetchOptions } from "./client";

/**
 * NBU rate resolution with a permanent JSON cache (data/rates.json):
 * 1. cache hit → { source: "cache", stale: false }
 * 2. single-date fetch → row is cached permanently → { source: "nbu", stale: false }
 * 3. `[]` (not published yet / weekend not yet published / future) → remembered in memory for
 *    15 min only (never persisted) → fallback
 * 4. network error / timeout → NBU marked offline (60 s, doubling on repeated failures up to 10 min) → fallback
 * fallback = newest cached rate on or before the date → { source: "cache", stale: true }
 * (refreshing the cache with a short range backfill when NBU is reachable). Nothing → RateUnavailableError.
 */

export type RateSourceKind = "cache" | "nbu" | "fixed";

export interface RateResult {
  currency: Currency;
  /** The requested date. */
  date: ISODate;
  /** UAH per 1 unit. */
  rate: number;
  /** Date of the rate actually used (< date when stale). */
  effectiveDate: ISODate;
  /** "fixed" = UAH (rate 1). */
  source: RateSourceKind;
  /** Not the official rate for `date` (fallback to an older cached rate). */
  stale: boolean;
}

export class RateUnavailableError extends Error {
  readonly currency: Currency;
  readonly date: ISODate;
  constructor(currency: Currency, date: ISODate, detail: string) {
    super(`NBU rate for ${currency} on ${date} is unavailable: ${detail}`);
    this.name = "RateUnavailableError";
    this.currency = currency;
    this.date = date;
  }
}

export class InvalidRateRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRateRequestError";
  }
}

export interface RateOptions {
  fetch?: NbuFetchOptions;
  /** Override "today" (Kyiv) — tests only. */
  today?: ISODate;
}

// ------------------------------------------------------------------ in-memory state (shared across bundles)

const NEGATIVE_TTL_MS = 15 * 60_000;
/** First offline window; doubles with every consecutive failure up to OFFLINE_MAX_MS. */
const OFFLINE_TTL_MS = 60_000;
const OFFLINE_MAX_MS = 10 * 60_000;

/**
 * Budget for NBU calls made while a page renders (header rates, balance conversion): one short
 * attempt, no retry — a slow or hanging bank.gov.ua must never hold a page for ~10 s.
 */
export const RENDER_FETCH: NbuFetchOptions = { timeoutMs: 2500, retries: 0 };
/** Optional probes (previous day, tomorrow): even shorter. */
const PROBE_FETCH: NbuFetchOptions = { timeoutMs: 1500, retries: 0 };

interface NbuMemory {
  negative: Map<string, number>;
  offlineUntil: number;
  /** Consecutive network failures (drives the offline back-off); reset by any successful call. */
  failures?: number;
  /** One in-flight single-date request per currency + date, shared by concurrent callers. */
  inflight?: Map<string, Promise<NbuDayRow | null>>;
}
const g = globalThis as unknown as { __budgetNbuMemory?: NbuMemory };
const memory: NbuMemory = (g.__budgetNbuMemory ??= { negative: new Map(), offlineUntil: 0 });
memory.failures ??= 0;
memory.inflight ??= new Map();
const inflight = memory.inflight;

/** Tests only: forget negative-cache entries, the offline flag and its back-off. */
export function resetNbuMemory(): void {
  memory.negative.clear();
  memory.offlineUntil = 0;
  memory.failures = 0;
  inflight.clear();
}

function isNegative(key: string): boolean {
  const until = memory.negative.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  memory.negative.delete(key);
  return false;
}

export function isNbuOffline(): boolean {
  return memory.offlineUntil > Date.now();
}

function markOffline() {
  const failures = (memory.failures ?? 0) + 1;
  memory.failures = failures;
  memory.offlineUntil = Date.now() + Math.min(OFFLINE_TTL_MS * 2 ** (failures - 1), OFFLINE_MAX_MS);
}

function markOnline() {
  memory.failures = 0;
}

/** Single-date fetch shared by concurrent callers (the first caller's budget applies). */
function fetchDayShared(currency: ForeignCurrency, date: ISODate, fetchOpts?: NbuFetchOptions): Promise<NbuDayRow | null> {
  const key = `${currency}:${date}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fetchNbuDay(currency, date, fetchOpts).then((row) => {
    markOnline();
    return row;
  });
  inflight.set(key, p);
  void p.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  );
  return p;
}

// ------------------------------------------------------------------ cache helpers

export function latestCachedRate(
  cache: RatesCache,
  currency: ForeignCurrency,
  onOrBefore: ISODate,
): { date: ISODate; rate: number } | null {
  let best: ISODate | null = null;
  for (const d of Object.keys(cache[currency])) {
    if (d <= onOrBefore && (best === null || d > best)) best = d;
  }
  return best ? { date: best, rate: cache[currency][best].rate } : null;
}

async function storeRows(currency: ForeignCurrency, rows: { date: ISODate; rate: number; calcdate?: ISODate }[], backfill = false) {
  if (rows.length === 0) return;
  const fetchedAt = nowIso();
  await updateRatesCache((cache) => {
    for (const r of rows) {
      cache[currency][r.date] = { rate: r.rate, ...(r.calcdate ? { calcdate: r.calcdate } : {}), fetchedAt };
    }
    if (backfill) cache.meta.lastBackfillAt = fetchedAt;
  });
}

function validate(currency: unknown, date: unknown): asserts currency is Currency {
  if (currency !== "UAH" && !isNbuCurrency(currency)) {
    throw new InvalidRateRequestError(`Unsupported currency "${String(currency)}" (allowed: ${[...NBU_CURRENCIES, "UAH"].join(", ")})`);
  }
  if (!isValidDate(date)) throw new InvalidRateRequestError(`Invalid date "${String(date)}" (expected YYYY-MM-DD)`);
}

// ------------------------------------------------------------------ public API

/** Range backfill via the exchange_site endpoint (rate_per_unit). Returns rows stored. Throws NbuError. */
export async function backfillRates(
  currency: ForeignCurrency,
  from: ISODate,
  to: ISODate,
  opts: RateOptions = {},
): Promise<number> {
  const today = opts.today ?? todayKyiv();
  const end = to > today ? addDays(today, 1) : to; // tomorrow may already be published
  if (from > end) return 0;
  try {
    const rows = await fetchNbuRange(currency, from, end, opts.fetch);
    markOnline();
    await storeRows(currency, rows, true);
    return rows.length;
  } catch (err) {
    if (err instanceof NbuError && err.kind !== "bad-response") markOffline();
    throw err;
  }
}

/**
 * Exact official rate for a date (cache, else one NBU call) WITHOUT fallback.
 * null when NBU has no row (yet) or is unreachable. Used for "tomorrow" / "previous day".
 */
export async function getExactRate(
  currency: ForeignCurrency,
  date: ISODate,
  opts: RateOptions = {},
): Promise<{ date: ISODate; rate: number; source: "cache" | "nbu" } | null> {
  validate(currency, date);
  const cache = await readRatesCache();
  const hit = cache[currency][date];
  if (hit) return { date, rate: hit.rate, source: "cache" };
  const key = `${currency}:${date}`;
  if (isNegative(key) || isNbuOffline()) return null;
  try {
    const row = await fetchDayShared(currency, date, opts.fetch);
    if (!row) {
      memory.negative.set(key, Date.now() + NEGATIVE_TTL_MS);
      return null;
    }
    await storeRows(currency, [{ date: row.date, rate: row.rate }]);
    return row.date === date ? { date, rate: row.rate, source: "nbu" } : null;
  } catch (err) {
    if (err instanceof NbuError) {
      if (err.kind !== "bad-response") markOffline();
      return null;
    }
    throw err;
  }
}

/**
 * The NBU rate for `currency` on `date` (UAH → 1). Throws InvalidRateRequestError for bad
 * input and RateUnavailableError when neither NBU nor the cache can answer.
 */
export async function getRate(currency: Currency, date: ISODate, opts: RateOptions = {}): Promise<RateResult> {
  validate(currency, date);
  if (currency === "UAH") return { currency, date, rate: 1, effectiveDate: date, source: "fixed", stale: false };

  const cache = await readRatesCache();
  const hit = cache[currency][date];
  if (hit) return { currency, date, rate: hit.rate, effectiveDate: date, source: "cache", stale: false };

  const key = `${currency}:${date}`;
  let reason: "not-published" | "unavailable" = "not-published";
  if (isNbuOffline()) reason = "unavailable";
  else if (!isNegative(key)) {
    try {
      const row = await fetchDayShared(currency, date, opts.fetch);
      if (row) {
        await storeRows(currency, [{ date: row.date, rate: row.rate }]);
        if (row.date === date) return { currency, date, rate: row.rate, effectiveDate: date, source: "nbu", stale: false };
      } else {
        memory.negative.set(key, Date.now() + NEGATIVE_TTL_MS);
      }
    } catch (err) {
      if (!(err instanceof NbuError)) throw err;
      if (err.kind !== "bad-response") markOffline();
      reason = "unavailable";
    }
  }
  return fallback(currency, date, reason, opts);
}

async function fallback(
  currency: ForeignCurrency,
  date: ISODate,
  reason: "not-published" | "unavailable",
  opts: RateOptions,
): Promise<RateResult> {
  const today = opts.today ?? todayKyiv();
  let latest = latestCachedRate(await readRatesCache(), currency, date);
  const anchor = date < today ? date : today;
  // Refresh a missing/old fallback with a short range call while NBU is reachable.
  if (reason === "not-published" && !isNbuOffline() && (!latest || latest.date < addDays(anchor, -7))) {
    try {
      await backfillRates(currency, addDays(anchor, -14), anchor, opts);
      latest = latestCachedRate(await readRatesCache(), currency, date);
      const exact = latest && latest.date === date;
      if (exact && latest) return { currency, date, rate: latest.rate, effectiveDate: date, source: "nbu", stale: false };
    } catch {
      // keep whatever the cache had
    }
  }
  if (latest) return { currency, date, rate: latest.rate, effectiveDate: latest.date, source: "cache", stale: true };
  throw new RateUnavailableError(
    currency,
    date,
    reason === "unavailable" ? "NBU is unreachable and nothing is cached" : "NBU has not published it and nothing is cached",
  );
}

/**
 * Rates for many dates at once (e.g. transfer dates on the freelance page): one range backfill
 * for any missing past dates, then per-date resolution. Dates that cannot be resolved → null.
 */
export async function getRatesForDates(
  currency: ForeignCurrency,
  dates: readonly ISODate[],
  opts: RateOptions = {},
): Promise<Map<ISODate, RateResult | null>> {
  const unique = [...new Set(dates.filter(isValidDate))].sort();
  const out = new Map<ISODate, RateResult | null>();
  if (unique.length === 0) return out;
  const today = opts.today ?? todayKyiv();
  const cache = await readRatesCache();
  const missing = unique.filter((d) => !cache[currency][d] && d <= today);
  if (missing.length > 1 && !isNbuOffline()) {
    try {
      await backfillRates(currency, missing[0], missing[missing.length - 1], opts);
    } catch {
      // fall through to per-date resolution
    }
  }
  // One cache read for every hit (getRate re-reads and re-validates the whole file per call).
  const after = await readRatesCache();
  for (const d of unique) {
    const hit = after[currency][d];
    if (hit) {
      out.set(d, { currency, date: d, rate: hit.rate, effectiveDate: d, source: "cache", stale: false });
      continue;
    }
    try {
      out.set(d, await getRate(currency, d, opts));
    } catch (err) {
      if (err instanceof RateUnavailableError) out.set(d, null);
      else throw err;
    }
  }
  return out;
}

export interface HeaderRate {
  currency: ForeignCurrency;
  /** Today's (Kyiv) rate, or the latest cached when stale. */
  rate: number;
  effectiveDate: ISODate;
  stale: boolean;
  /** Previous calendar day's official rate. */
  previous: { date: ISODate; rate: number } | null;
  /** rate − previous.rate (4 decimals); null without a previous rate. */
  change: number | null;
  /** change / previous.rate (fraction). */
  changePct: number | null;
  /** Tomorrow's rate when NBU has already published it (usually after ~15:30 Kyiv). */
  tomorrow: { date: ISODate; rate: number } | null;
}

export interface HeaderRates {
  today: ISODate;
  USD: HeaderRate | null;
  EUR: HeaderRate | null;
  PLN: HeaderRate | null;
  /** True when NBU could not be reached (values may be stale or missing). */
  offline: boolean;
}

async function headerRate(currency: ForeignCurrency, today: ISODate, opts: RateOptions): Promise<HeaderRate | null> {
  let current: RateResult;
  try {
    current = await getRate(currency, today, opts);
  } catch (err) {
    if (err instanceof RateUnavailableError) return null;
    throw err;
  }
  // Optional extras: a short budget, so a hanging NBU costs ~1.5 s once, not 10 s on every page.
  const probe: RateOptions = {
    ...opts,
    fetch: { ...opts.fetch, retries: 0, timeoutMs: Math.min(opts.fetch?.timeoutMs ?? Infinity, PROBE_FETCH.timeoutMs ?? Infinity) },
  };
  const [previous, tomorrow] = await Promise.all([
    getExactRate(currency, addDays(today, -1), probe),
    getExactRate(currency, addDays(today, 1), probe),
  ]);
  const change = previous && !current.stale ? round4(current.rate - previous.rate) : null;
  return {
    currency,
    rate: current.rate,
    effectiveDate: current.effectiveDate,
    stale: current.stale,
    previous: previous ? { date: previous.date, rate: previous.rate } : null,
    change,
    changePct: change !== null && previous ? change / previous.rate : null,
    tomorrow: tomorrow ? { date: tomorrow.date, rate: tomorrow.rate } : null,
  };
}

/** Today's USD/EUR/PLN with change vs the previous day and tomorrow's rate if published. Never throws for NBU issues. */
export async function getHeaderRates(today: ISODate = todayKyiv(), opts: RateOptions = {}): Promise<HeaderRates> {
  const o = { ...opts, today };
  const [USD, EUR, PLN] = await Promise.all([headerRate("USD", today, o), headerRate("EUR", today, o), headerRate("PLN", today, o)]);
  return { today, USD, EUR, PLN, offline: isNbuOffline() };
}
