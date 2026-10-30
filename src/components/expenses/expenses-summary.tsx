import { Money } from "@/components/shared/money";
import { StatCard, StatRow } from "@/components/shared/stat-card";
import type { ExpensesPageData } from "@/server/queries";

/** The selected period at a glance (all accounts and categories): spent, income, net. Server Component. */
export function ExpensesSummary({ period }: { period: ExpensesPageData["period"] }) {
  return (
    <StatRow aria-label="Period summary">
      <StatCard label="Spent" value={<Money amount={period.spendingUah} currency="UAH" tabular={false} data-testid="period-spent" />} />
      <StatCard label="Income" value={<Money amount={period.incomeUah} currency="UAH" tabular={false} data-testid="period-income" />} />
      <StatCard
        label="Net"
        value={<Money amount={period.netUah} currency="UAH" signed colored tabular={false} data-testid="period-net" />}
      />
    </StatRow>
  );
}
