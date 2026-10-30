"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { Money, type MoneyProps } from "@/components/shared/money";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CURRENCIES, CURRENCY_SYMBOL, convertFromUah, formatMoney, formatRate, type Currency } from "@/lib/money";
import { DISPLAY_CURRENCY_COOKIE, type DisplayRates } from "./display-currency-shared";

interface DisplayCurrencyState {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  rates: DisplayRates;
}

const DisplayCurrencyContext = createContext<DisplayCurrencyState | null>(null);

/**
 * Overview display currency: UAH totals are shown converted at today's NBU rate — a view only, nothing
 * stored changes. The choice is kept in a cookie (read by the server, so the page renders in it at once).
 */
export function DisplayCurrencyProvider({ initial, rates, children }: { initial: Currency; rates: DisplayRates; children: React.ReactNode }) {
  const [currency, setState] = useState<Currency>(initial);
  const value = useMemo<DisplayCurrencyState>(
    () => ({
      currency,
      rates,
      setCurrency(next) {
        setState(next);
        document.cookie = `${DISPLAY_CURRENCY_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      },
    }),
    [currency, rates],
  );
  return <DisplayCurrencyContext.Provider value={value}>{children}</DisplayCurrencyContext.Provider>;
}

/** Outside a provider everything stays in UAH. */
function useDisplay(): DisplayCurrencyState {
  return useContext(DisplayCurrencyContext) ?? { currency: "UAH", setCurrency: () => {}, rates: {} };
}

/** The UAH amount in the chosen currency (or null when there is no rate → stay in UAH). */
function convert(amountUah: number, currency: Currency, rates: DisplayRates): { amount: number; currency: Currency; rate: number | null } {
  if (currency === "UAH") return { amount: amountUah, currency: "UAH", rate: null };
  const rate = rates[currency];
  return rate ? { amount: convertFromUah(amountUah, rate), currency, rate } : { amount: amountUah, currency: "UAH", rate: null };
}

export type DisplayMoneyProps = Omit<MoneyProps, "amount" | "currency"> & { amountUah: number };

/** A UAH amount shown in the Overview's display currency; the exact UAH figure is in the tooltip. */
export function DisplayMoney({ amountUah, title, ...props }: DisplayMoneyProps) {
  const { currency, rates } = useDisplay();
  const v = convert(amountUah, currency, rates);
  const exact = v.rate ? `${formatMoney(amountUah, "UAH")} at ${formatRate(v.rate)} ₴ per ${CURRENCY_SYMBOL[v.currency]}` : undefined;
  return <Money amount={v.amount} currency={v.currency} title={title ?? exact} data-display-currency={v.currency} {...props} />;
}

/** "UAH" / "USD" … — for labels like "In UAH". */
export function DisplayCurrencyCode() {
  const { currency, rates } = useDisplay();
  return <>{currency === "UAH" || rates[currency] ? currency : "UAH"}</>;
}

/** "Show in ₴ / $ / € / zł" — Overview only, view only. */
export function DisplayCurrencyToggle() {
  const { currency, setCurrency, rates } = useDisplay();
  return (
    <div className="flex items-center" data-testid="display-currency">
      <ToggleGroup
        type="single"
        size="sm"
        spacing={0}
        value={currency}
        onValueChange={(v) => v && setCurrency(v as Currency)}
        aria-label="Show in"
      >
        {CURRENCIES.map((c) => {
          const available = c === "UAH" || !!rates[c];
          return (
            <ToggleGroupItem
              key={c}
              value={c}
              disabled={!available}
              aria-label={c}
              title={available ? (c === "UAH" ? "Hryvnia (as stored)" : `Converted at today's NBU rate: ${formatRate(rates[c]!)} ₴`) : "No NBU rate yet"}
              className="min-w-8 px-2 text-xs text-muted-foreground data-[state=on]:bg-accent data-[state=on]:font-medium data-[state=on]:text-foreground"
            >
              {CURRENCY_SYMBOL[c]}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
