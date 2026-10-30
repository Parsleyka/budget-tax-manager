import { Badge } from "@/components/ui/badge";
import { CURRENCY_LABELS } from "@/lib/labels";
import { CURRENCY_SYMBOL } from "@/lib/money";
import type { Currency } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface CurrencyBadgeProps {
  currency: Currency;
  /** Append the symbol: "USD $". Default false. */
  withSymbol?: boolean;
  className?: string;
}

/** Small outline pill with the ISO code ("USD"). Full name in the tooltip/title. */
export function CurrencyBadge({ currency, withSymbol = false, className }: CurrencyBadgeProps) {
  return (
    <Badge
      variant="outline"
      title={CURRENCY_LABELS[currency]}
      className={cn("h-5 rounded-md px-1.5 font-mono text-[0.68rem] font-medium tracking-wide text-muted-foreground", className)}
    >
      {currency}
      {withSymbol ? <span className="font-sans text-foreground/70">{CURRENCY_SYMBOL[currency]}</span> : null}
    </Badge>
  );
}
