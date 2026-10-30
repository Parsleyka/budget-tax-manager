/**
 * Overview "Show in" currency (display only). Plain module — no "use client" — so the server page can
 * read the cookie with the same name and validation the client writes it with.
 */
import { CURRENCIES, type Currency } from "@/lib/money";

export const DISPLAY_CURRENCY_COOKIE = "overview_currency";

/** UAH per 1 unit of each foreign currency (today's NBU); null = no rate (that option is disabled). */
export type DisplayRates = Partial<Record<Exclude<Currency, "UAH">, number | null>>;

/** A cookie value → a currency that can be shown now (needs a rate), else UAH. */
export function parseDisplayCurrency(value: string | undefined, rates: DisplayRates): Currency {
  const c = CURRENCIES.find((x) => x === value);
  if (!c || c === "UAH") return "UAH";
  return rates[c] ? c : "UAH";
}
