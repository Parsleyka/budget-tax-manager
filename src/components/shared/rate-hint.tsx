import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, type ISODate } from "@/lib/dates";
import { CURRENCY_SYMBOL, formatRate } from "@/lib/money";
import type { Currency } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface RateHintProps {
  /** The foreign currency the rate is for (UAH per 1 unit). */
  currency: Currency;
  /** null while loading / unavailable. */
  rate: number | null;
  /** The date the rate was requested for. */
  date?: ISODate | null;
  /** The date of the rate actually used (older than `date` when stale). Defaults to `date`. */
  effectiveDate?: ISODate | null;
  /** "nbu" | "cache" → "NBU"; "manual" → "Manual" badge; "fixed" → UAH (renders nothing). */
  source?: "nbu" | "cache" | "manual" | "fixed";
  stale?: boolean;
  loading?: boolean;
  /** Shown instead of the rate (e.g. "NBU rate unavailable — enter it manually"). */
  error?: string | null;
  className?: string;
}

/** "NBU · 1 $ = 41,2345 ₴ · 15 Oct 2026" with Stale / Manual badges. Server- and client-safe. */
export function RateHint({ currency, rate, date, effectiveDate, source = "nbu", stale, loading, error, className }: RateHintProps) {
  if (currency === "UAH" || source === "fixed") return null;
  const base = "inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground";
  if (loading) {
    return (
      <span className={cn(base, className)} aria-live="polite">
        <Spinner className="size-3" /> Fetching NBU rate{date ? ` for ${formatDate(date)}` : ""}…
      </span>
    );
  }
  if (error || rate === null) {
    return (
      <span className={cn(base, "text-warning", className)} role="status">
        <TriangleAlert aria-hidden className="size-3.5" />
        {error ?? "NBU rate unavailable"}
      </span>
    );
  }
  const shownDate = effectiveDate ?? date;
  return (
    <span className={cn(base, className)} data-slot="rate-hint">
      {source !== "manual" ? (
        <>
          <span className="font-medium text-foreground/80">NBU</span>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <span className="tabular-nums">
        1 {CURRENCY_SYMBOL[currency]} = {formatRate(rate)} ₴
      </span>
      {shownDate && source !== "manual" ? (
        <>
          <span aria-hidden>·</span>
          <span>{formatDate(shownDate)}</span>
        </>
      ) : null}
      {stale ? (
        <Badge variant="outline" className="h-4 border-warning/40 px-1.5 text-[0.65rem] text-warning" title="Not the official rate for this date (latest available)">
          Stale
        </Badge>
      ) : null}
      {source === "manual" ? (
        <Badge variant="outline" className="h-4 px-1.5 text-[0.65rem]">
          Manual
        </Badge>
      ) : null}
    </span>
  );
}
