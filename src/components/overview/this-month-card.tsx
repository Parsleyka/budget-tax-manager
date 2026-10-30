import Link from "next/link";
import type * as React from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { PeriodTotals } from "@/lib/analytics";
import { formatDateRange, monthName, monthNumber } from "@/lib/dates";
import type { DateRange } from "@/lib/periods";
import { DisplayMoney } from "./display-currency";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** This month (1st → today): income, spending and the difference. */
export function ThisMonthCard({
  thisMonth,
  className,
}: {
  thisMonth: { range: DateRange; totals: PeriodTotals };
  className?: string;
}) {
  const { range, totals: t } = thisMonth;
  const empty = t.incomeCount + t.expenseCount === 0;

  return (
    <SectionCard
      className={className}
      title="This month"
      description={formatDateRange(range.from, range.to)}
      action={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/expenses?period=this-month">Spendings</Link>
        </Button>
      }
    >
      {empty ? (
        <p className="text-sm text-muted-foreground">Nothing recorded in {monthName(monthNumber(range.to), true)} yet.</p>
      ) : (
        <dl className="flex flex-col divide-y" data-testid="this-month">
          <Row label="Income">
            <DisplayMoney amountUah={t.incomeUah} className="text-sm font-medium" />
          </Row>
          <Row label="Spending">
            <DisplayMoney amountUah={t.spendingUah} className="text-sm font-medium" />
          </Row>
          <Row label="Net">
            <DisplayMoney amountUah={t.netUah} signed colored className="text-sm font-semibold" />
          </Row>
        </dl>
      )}
    </SectionCard>
  );
}
