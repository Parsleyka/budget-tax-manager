import { formatMoneyDisplay, Money } from "@/components/shared/money";
import { StatCard, StatRow } from "@/components/shared/stat-card";
import type { DebtSideTotals, DebtsSummary as Summary } from "@/lib/debts";
import type { Currency } from "@/lib/types";

const ORDER: readonly Currency[] = ["UAH", "USD", "EUR", "PLN"];

/** "100,00 $ + 2 000,00 ₴" — only when something is in a foreign currency (otherwise the UAH figure says it all). */
function currencyBreakdown(side: DebtSideTotals): string | null {
  const parts = ORDER.filter((c) => side.byCurrency[c] !== undefined);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "UAH")) return null;
  return parts.map((c) => formatMoneyDisplay(side.byCurrency[c]!, c)).join(" + ");
}

function sideHint(side: DebtSideTotals) {
  const warning = side.incomplete ? `Excludes ${side.missingRates.join(" & ")} — no NBU rate yet` : side.stale ? "Converted at an older NBU rate" : null;
  const breakdown = currencyBreakdown(side);
  if (!warning && !breakdown) return null;
  return (
    <span className="flex flex-col gap-0.5">
      {breakdown ? <span className="tabular-nums">{breakdown}</span> : null}
      {warning ? <span className="text-warning">{warning}</span> : null}
    </span>
  );
}

/** Owed to you · you owe (UAH at today's NBU rates) · overdue (only when something is). */
export function DebtsSummary({ summary }: { summary: Summary }) {
  return (
    <StatRow aria-label="Debts summary">
      <StatCard
        label="Owed to you"
        value={<Money amount={summary.lent.totalUah} currency="UAH" tabular={false} data-testid="owed-to-you" />}
        hint={sideHint(summary.lent)}
      />
      <StatCard
        label="You owe"
        value={<Money amount={summary.borrowed.totalUah} currency="UAH" tabular={false} data-testid="you-owe" />}
        hint={sideHint(summary.borrowed)}
      />
      {summary.overdueCount > 0 ? (
        <StatCard label="Overdue" value={<span className="text-negative">{summary.overdueCount}</span>} />
      ) : null}
    </StatRow>
  );
}
