"use client";

import { ArrowDownRight, ArrowUpRight, Minus, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDayMonth, formatWeekday } from "@/lib/dates";
import { CURRENCY_LABELS } from "@/lib/labels";
import { formatPercent, formatRate, round4 } from "@/lib/money";
import type { ForeignCurrency } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { HeaderRate, HeaderRates } from "@/server/nbu/rates";

const CURRENCIES: readonly ForeignCurrency[] = ["USD", "EUR", "PLN"];
const SYMBOL: Record<ForeignCurrency, string> = { USD: "$", EUR: "€", PLN: "zł" };

function signed(n: number, digits = 4): string {
  const s = formatRate(Math.abs(n), digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

function ChangeIcon({ change, className }: { change: number | null; className?: string }) {
  const Icon = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return <Icon aria-hidden className={cn("size-3.5", className)} />;
}

function RateChip({ currency, rate }: { currency: ForeignCurrency; rate: HeaderRate | null }) {
  if (!rate) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <span className="text-xs font-medium">{currency}</span> —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        <span className="sm:hidden">{SYMBOL[currency]}</span>
        <span className="hidden sm:inline">{currency}</span>
      </span>
      <span className="tabular-nums">{formatRate(rate.rate, 2)}</span>
      {rate.stale ? (
        <span className="size-1.5 rounded-full bg-warning">
          <span className="sr-only"> (stale)</span>
        </span>
      ) : null}
    </span>
  );
}

function RateDetails({ currency, rate }: { currency: ForeignCurrency; rate: HeaderRate | null }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={`rate-details-${currency}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">
          {CURRENCY_LABELS[currency]} <span className="text-xs text-muted-foreground">{currency}</span>
        </span>
        <span className="text-base font-semibold tabular-nums">{rate ? `${formatRate(rate.rate)} ₴` : "—"}</span>
      </div>
      {rate ? (
        <>
          {rate.stale ? (
            <div className="flex items-center gap-1.5 text-xs text-warning">
              <Badge variant="outline" className="h-4 border-warning/40 px-1.5 text-[0.65rem] text-warning">
                Stale
              </Badge>
              Latest available rate is from {formatDate(rate.effectiveDate)}
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span>{rate.previous ? `vs ${formatDayMonth(rate.previous.date)} (${formatRate(rate.previous.rate)})` : "No previous-day rate"}</span>
            {rate.change !== null ? (
              <span className="inline-flex items-center gap-0.5 tabular-nums text-foreground/80">
                <ChangeIcon change={rate.change} />
                {signed(rate.change)}
                {rate.changePct !== null ? ` (${rate.changePct > 0 ? "+" : rate.changePct < 0 ? "−" : ""}${formatPercent(Math.abs(rate.changePct), 2)})` : ""}
              </span>
            ) : null}
          </div>
          {rate.tomorrow ? (
            <div className="flex items-baseline justify-between gap-3 rounded-md bg-muted/60 px-2 py-1 text-xs">
              <span className="text-muted-foreground">
                From tomorrow, {formatWeekday(rate.tomorrow.date)} {formatDayMonth(rate.tomorrow.date)}
              </span>
              <span className="font-medium tabular-nums">
                {formatRate(rate.tomorrow.rate)} ₴{" "}
                <span className="text-muted-foreground">({signed(round4(rate.tomorrow.rate - rate.rate))})</span>
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Rate unavailable — NBU could not be reached and nothing is cached yet.</p>
      )}
    </div>
  );
}

/** Placeholder while the header rates stream in (same footprint as the widget's button). */
export function HeaderRatesSkeleton() {
  return (
    <div className="flex h-8 items-center gap-3 px-2" aria-busy="true" aria-label="Loading NBU rates" data-testid="header-rates-loading">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
}

/** Compact NBU USD/EUR/PLN rates for the top bar; click for details (change, tomorrow's rate, staleness). */
export function HeaderRatesWidget({ rates }: { rates: HeaderRates }) {
  const anyStale = rates.offline || CURRENCIES.some((c) => rates[c]?.stale);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-4 px-2 text-sm font-normal"
          title={`NBU rates${anyStale ? " (stale)" : ""} — click for details`}
          data-testid="header-rates"
        >
          {/* The visible rates are the button's name (WCAG 2.5.3); this prefix only adds context. */}
          <span className="sr-only">NBU rates:</span>
          {CURRENCIES.map((c) => (
            <RateChip key={c} currency={c} rate={rates[c]} />
          ))}
          {rates.offline ? <WifiOff aria-hidden className="size-3.5 text-warning" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
          <span className="text-sm font-semibold">NBU official rates</span>
          <span className="text-xs text-muted-foreground">
            {formatWeekday(rates.today)}, {formatDate(rates.today)}
          </span>
        </div>
        <Separator />
        <div className="flex flex-col gap-3 px-4 py-3">
          {CURRENCIES.map((c, i) => (
            <div key={c} className="flex flex-col gap-3">
              {i > 0 ? <Separator /> : null}
              <RateDetails currency={c} rate={rates[c]} />
            </div>
          ))}
        </div>
        {rates.offline ? (
          <>
            <Separator />
            <p className="flex items-center gap-1.5 px-4 py-2 text-xs text-warning">
              <WifiOff aria-hidden className="size-3.5" /> NBU is unreachable — showing cached rates.
            </p>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
