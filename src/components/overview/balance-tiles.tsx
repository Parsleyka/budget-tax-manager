import { StatCard, StatRow } from "@/components/shared/stat-card";
import { formatDayMonth } from "@/lib/dates";
import type { BalanceSheet } from "@/lib/ledger";
import { cn } from "@/lib/utils";
import { DisplayMoney } from "./display-currency";
import { oldestStaleRateDate } from "./overview-model";

/** Headline balances: Net worth (the hero), then Active and Frozen. */
export function BalanceTiles({ balances, className }: { balances: BalanceSheet; className?: string }) {
  const staleSince = oldestStaleRateDate(balances);
  const missing = balances.missingRates;
  const rateNote =
    missing.length > 0 ? (
      <span className="text-warning">Excludes {missing.join(" & ")} — no NBU rate yet</span>
    ) : staleSince ? (
      <span className="text-warning">At NBU rates from {formatDayMonth(staleSince)}</span>
    ) : null;

  return (
    <section aria-label="Balances" className={cn("flex flex-col gap-6", className)}>
      <StatCard
        size="hero"
        label="Net worth"
        value={<DisplayMoney amountUah={balances.netWorthUah} tabular={false} data-testid="net-worth" />}
        hint={rateNote}
      />
      <StatRow>
        <StatCard
          label="Active balance"
          value={<DisplayMoney amountUah={balances.activeUah} tabular={false} data-testid="active-balance" />}
        />
        <StatCard
          label="Frozen balance"
          value={<DisplayMoney amountUah={balances.frozenUah} tabular={false} data-testid="frozen-balance" />}
        />
      </StatRow>
    </section>
  );
}
