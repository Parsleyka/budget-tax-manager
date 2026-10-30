import "server-only";
import { formatDate } from "@/lib/dates";
import { formatRate } from "@/lib/money";
import type { Currency, RateSource } from "@/lib/types";
import { getRate, RateUnavailableError, type RateOptions } from "../nbu/rates";
import { fail, type Failure } from "./result";

/**
 * Resolve the rate stored on an income/expense. UAH → 1. rateSource "manual" → the client's
 * rate is trusted (already validated ≤ 4 decimals). Otherwise the NBU rate for `date` is
 * re-resolved server-side; a stale fallback is NOT accepted (it would corrupt the tax base) —
 * the client is told to enter the rate manually instead.
 */
export async function resolveEntryRate(
  currency: Currency,
  date: string,
  rateSource: RateSource,
  manualRate: number | null | undefined,
  opts?: RateOptions,
): Promise<{ rate: number; rateSource: RateSource } | Failure> {
  if (currency === "UAH") return { rate: 1, rateSource: "nbu" };
  if (rateSource === "manual") {
    if (manualRate === null || manualRate === undefined) return fail("Enter the exchange rate", { rate: ["Enter the exchange rate"] });
    return { rate: manualRate, rateSource: "manual" };
  }
  try {
    const r = await getRate(currency, date, opts);
    if (r.stale) {
      const msg =
        `The official NBU ${currency} rate for ${formatDate(date)} is not available yet ` +
        `(latest known: ${formatRate(r.rate)} on ${formatDate(r.effectiveDate)}). Enter the rate manually.`;
      return fail(msg, { rate: [msg] });
    }
    return { rate: r.rate, rateSource: "nbu" };
  } catch (err) {
    if (err instanceof RateUnavailableError) {
      const msg = `NBU ${currency} rate for ${formatDate(date)} is unavailable. Enter the rate manually.`;
      return fail(msg, { rate: [msg] });
    }
    throw err;
  }
}
