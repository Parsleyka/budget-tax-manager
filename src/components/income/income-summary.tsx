import { Money, formatMoneyDisplay } from "@/components/shared/money";
import { StatCard, StatRow } from "@/components/shared/stat-card";
import type { IncomePageData } from "@/server/queries";
import { pluralIncomes } from "./income-view";

/**
 * Figures of the Income page: total received, salary, gross freelance. Totals cover BOTH kinds for the
 * selected period, whatever tab is open. Server-safe.
 */
export function IncomeSummary({ totals }: { totals: IncomePageData["totals"] }) {
  const hasFees = totals.feesUah > 0;
  return (
    <StatRow aria-label="Income summary">
      <StatCard
        label="Total received"
        value={<Money amount={totals.receivedUah} currency="UAH" tabular={false} />}
        hint={totals.count ? pluralIncomes(totals.count) : "No income in this period"}
      />
      <StatCard label="Salary" value={<Money amount={totals.salaryUah} currency="UAH" tabular={false} />} />
      <StatCard
        label="Freelance"
        value={<Money amount={totals.freelanceUah} currency="UAH" tabular={false} />}
        hint={hasFees ? `fees ${formatMoneyDisplay(totals.feesUah, "UAH")}` : undefined}
      />
    </StatRow>
  );
}
