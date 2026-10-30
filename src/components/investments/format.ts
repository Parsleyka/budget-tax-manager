import { formatPercent } from "@/lib/money";

/** After this many days without a value update an account asks for one. */
export const STALE_DAYS = 31;

/** 0.123 → "+12,3%" (one decimal, always signed). */
export function signedPercent(pct: number): string {
  return `${pct >= 0 ? "+" : "−"}${formatPercent(Math.abs(pct), 1)}`;
}
