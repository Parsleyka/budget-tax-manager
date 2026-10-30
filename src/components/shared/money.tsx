import type * as React from "react";
import { formatMoney } from "@/lib/money";
import type { Currency } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface MoneyProps extends Omit<React.ComponentProps<"span">, "children"> {
  /** Major units (e.g. 1234.56). */
  amount: number;
  currency: Currency;
  /** Print "+" / "−" for non-zero amounts (deltas). */
  signed?: boolean;
  /** Color by sign: > 0 → `text-positive`, < 0 → `text-negative`, 0 → inherit. */
  colored?: boolean;
  /**
   * For always-positive amounts that carry a direction (e.g. `TransactionRow`):
   * "in" → "+1 000,00 ₴" green, "out" → "−1 000,00 ₴" red, "neutral" → plain.
   * Implies `signed` + `colored` for in/out.
   */
  direction?: "in" | "out" | "neutral";
  /** Compact notation ("41,2K ₴") — chart axes / tight tiles. Full value goes to `title`. */
  compact?: boolean;
  /** Drop kopecks. */
  noDecimals?: boolean;
  /** Aligned digits (default true). Set false for big standalone figures (stat tiles, hero). */
  tabular?: boolean;
}

/** Formats with a real minus sign (U+2212) instead of the hyphen Intl emits. */
export function formatMoneyDisplay(
  amount: number,
  currency: Currency,
  options: { signed?: boolean; compact?: boolean; noDecimals?: boolean } = {},
): string {
  return formatMoney(amount, currency, {
    signDisplay: options.signed ? "exceptZero" : "auto",
    compact: options.compact,
    noDecimals: options.noDecimals,
  }).replace("-", "−");
}

/**
 * Money amount: `41 230,50 ₴` (uk-UA, narrow symbol), tabular digits, never wraps.
 * Server- and client-safe (no hooks).
 */
export function Money({
  amount,
  currency,
  signed,
  colored,
  direction,
  compact,
  noDecimals,
  tabular = true,
  className,
  title,
  ...props
}: MoneyProps) {
  const value = direction === "out" ? -Math.abs(amount) : direction === "in" ? Math.abs(amount) : amount;
  const showSign = signed || direction === "in" || direction === "out";
  const color = colored || direction === "in" || direction === "out";
  const text = formatMoneyDisplay(value, currency, { signed: showSign, compact, noDecimals });
  return (
    <span
      data-slot="money"
      className={cn(
        "whitespace-nowrap",
        tabular && "tabular-nums",
        color && value > 0 && "text-positive",
        color && value < 0 && "text-negative",
        className,
      )}
      title={title ?? (compact ? formatMoneyDisplay(value, currency, { signed: showSign }) : undefined)}
      {...props}
    >
      {text}
    </span>
  );
}
