import "server-only";
import { fromNbuDate, isValidDate, toNbuDate, type ISODate } from "@/lib/dates";
import { hasAtMostDecimals } from "@/lib/money";
import type { ForeignCurrency } from "@/lib/types";

/**
 * Thin NBU HTTP client (research/nbu-api.md).
 * - Always passes an explicit date (the no-date call returns TOMORROW's rate after ~15:30).
 * - Errors arrive as HTTP 200 with non-JSON bodies ("Wrong date format") → NbuError("bad-response").
 * - `[]` means "no row for that date (yet)" → returned as null / empty list, never an error.
 * - Timeout per attempt + one retry on network/timeout/bad-response/5xx.
 */
export const NBU_EXCHANGE_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";
export const NBU_RANGE_URL = "https://bank.gov.ua/NBU_Exchange/exchange_site";

export const NBU_CURRENCIES = ["USD", "EUR", "PLN"] as const satisfies readonly ForeignCurrency[];

export function isNbuCurrency(value: unknown): value is ForeignCurrency {
  return (NBU_CURRENCIES as readonly unknown[]).includes(value);
}

export type NbuErrorKind = "network" | "timeout" | "http" | "bad-response";

export class NbuError extends Error {
  readonly kind: NbuErrorKind;
  constructor(kind: NbuErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NbuError";
    this.kind = kind;
  }
}

export interface NbuFetchOptions {
  /** Per-attempt timeout. Default 5000 ms. */
  timeoutMs?: number;
  /** Extra attempts after the first. Default 1. */
  retries?: number;
  /** Pause before a retry. Default 300 ms. */
  retryDelayMs?: number;
}

export interface NbuDayRow {
  currency: ForeignCurrency;
  /** The row's exchangedate (ISO). */
  date: ISODate;
  rate: number;
}

export interface NbuRangeRow {
  date: ISODate;
  /** rate_per_unit (UAH per 1 unit). */
  rate: number;
  /** Business day the rate was set, when present. */
  calcdate?: ISODate;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchTextOnce(url: string, timeoutMs: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new NbuError("timeout", `NBU request timed out after ${timeoutMs} ms`, { cause: err });
    }
    throw new NbuError("network", `NBU request failed: ${(err as Error)?.message ?? String(err)}`, { cause: err });
  }
  if (!res.ok) throw new NbuError("http", `NBU responded with HTTP ${res.status}`);
  try {
    return await res.text();
  } catch (err) {
    throw new NbuError("network", "Failed to read NBU response body", { cause: err });
  }
}

async function withRetry<T>(fn: () => Promise<T>, opts: NbuFetchOptions): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof NbuError;
      if (!retryable || attempt === retries) break;
      await sleep(opts.retryDelayMs ?? 300);
    }
  }
  throw lastErr;
}

function parseJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[")) throw new NbuError("bad-response", `Unexpected NBU response: ${trimmed.slice(0, 80)}`);
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    // e.g. "[ { Wrong date format } ]"
    throw new NbuError("bad-response", `NBU returned an error: ${trimmed.replace(/\s+/g, " ").slice(0, 80)}`);
  }
  if (!Array.isArray(json)) throw new NbuError("bad-response", "NBU response is not an array");
  return json;
}

function readRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new NbuError("bad-response", `Invalid rate in NBU response: ${String(value)}`);
  }
  // USD/EUR have ≤ 4 decimals; guard anyway so stored rates stay valid.
  return hasAtMostDecimals(value, 4) ? value : Math.round(value * 10_000) / 10_000;
}

/** Parse the single-date endpoint body. null = `[]` (no row). */
export function parseNbuDayBody(text: string, currency: ForeignCurrency): NbuDayRow | null {
  const arr = parseJsonArray(text);
  if (arr.length === 0) return null;
  const row = arr.find((r) => typeof r === "object" && r !== null && String((r as { cc?: unknown }).cc).toUpperCase() === currency);
  if (!row || typeof row !== "object") throw new NbuError("bad-response", "NBU response has no matching row");
  const r = row as { rate?: unknown; exchangedate?: unknown };
  const date = typeof r.exchangedate === "string" ? fromNbuDate(r.exchangedate) : null;
  if (!date) throw new NbuError("bad-response", "NBU row has an invalid exchangedate");
  return { currency, date, rate: readRate(r.rate) };
}

/** Parse the range endpoint body (uses rate_per_unit, never `rate`). */
export function parseNbuRangeBody(text: string, currency: ForeignCurrency): NbuRangeRow[] {
  const arr = parseJsonArray(text);
  const out: NbuRangeRow[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) throw new NbuError("bad-response", "Invalid NBU range row");
    const r = item as { cc?: unknown; exchangedate?: unknown; rate_per_unit?: unknown; calcdate?: unknown };
    if (typeof r.cc === "string" && r.cc.toUpperCase() !== currency) continue;
    const date = typeof r.exchangedate === "string" ? fromNbuDate(r.exchangedate) : null;
    if (!date) throw new NbuError("bad-response", "NBU range row has an invalid exchangedate");
    const calcdate = typeof r.calcdate === "string" ? fromNbuDate(r.calcdate) : null;
    out.push({ date, rate: readRate(r.rate_per_unit), ...(calcdate ? { calcdate } : {}) });
  }
  return out;
}

export function nbuDayUrl(currency: ForeignCurrency, date: ISODate): string {
  return `${NBU_EXCHANGE_URL}?valcode=${currency}&date=${toNbuDate(date)}&json`;
}

export function nbuRangeUrl(currency: ForeignCurrency, from: ISODate, to: ISODate): string {
  return `${NBU_RANGE_URL}?start=${toNbuDate(from)}&end=${toNbuDate(to)}&valcode=${currency.toLowerCase()}&sort=exchangedate&order=asc&json`;
}

function assertInputs(currency: ForeignCurrency, ...dates: ISODate[]) {
  if (!isNbuCurrency(currency)) throw new RangeError(`Unsupported currency: ${String(currency)}`);
  for (const d of dates) if (!isValidDate(d)) throw new RangeError(`Invalid date: ${d}`);
}

/** One official rate for a calendar date; null when NBU has no row (yet). */
export async function fetchNbuDay(currency: ForeignCurrency, date: ISODate, opts: NbuFetchOptions = {}): Promise<NbuDayRow | null> {
  assertInputs(currency, date);
  const url = nbuDayUrl(currency, date);
  return withRetry(async () => parseNbuDayBody(await fetchTextOnce(url, opts.timeoutMs ?? 5000), currency), opts);
}

/** Every calendar day in [from, to] that NBU has published (future days are simply absent). */
export async function fetchNbuRange(
  currency: ForeignCurrency,
  from: ISODate,
  to: ISODate,
  opts: NbuFetchOptions = {},
): Promise<NbuRangeRow[]> {
  assertInputs(currency, from, to);
  if (from > to) return [];
  const url = nbuRangeUrl(currency, from, to);
  return withRetry(async () => parseNbuRangeBody(await fetchTextOnce(url, opts.timeoutMs ?? 10_000), currency), opts);
}
