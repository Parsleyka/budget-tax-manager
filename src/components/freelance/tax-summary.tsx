"use client";

import type * as React from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard, StatRow } from "@/components/shared/stat-card";
import { formatMoney, formatPercent, subtractMoney } from "@/lib/money";
import type { LimitStatus, QuarterPaymentStatus } from "@/lib/tax/engine";
import type { Settings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { currencyTotals, describeSelection, formatBp, levySummary, selectionPayments, type SelectionPayments } from "./model";
import { useFreelanceSelection } from "./selection-context";

export interface TaxSummaryProps {
  settings: Settings;
  /** Annual limit status for the whole year (all income, not only the selection). */
  limit: LimitStatus;
  /** Next to the tax lines (e.g. upcoming deadlines). */
  aside?: React.ReactNode;
  /**
   * Paid vs due per quarter of the viewed year (declaration statuses). The calculation is an accrual;
   * with this the tax figure also says how much of the selected quarters is paid and what is left.
   */
  paymentStatus?: readonly QuarterPaymentStatus[];
  /**
   * "Include ЄСВ" is on: the calculation (from the selection context) contains the minimum ЄСВ as an
   * optional preview — the saved mode owes none. `paymentStatus` stays real, so "still to pay" excludes it.
   */
  esvOptional?: boolean;
}

function Line({ label, rate, amount, total, testId }: { label: React.ReactNode; rate?: string; amount: number; total?: boolean; testId?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2.5", total && "font-semibold")}>
      <dt className={cn(!total && "text-muted-foreground")}>
        {label}
        {rate ? <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{rate}</span> : null}
      </dt>
      <dd className={cn("text-right", !total && "text-foreground")}>
        <Money amount={amount} currency="UAH" data-testid={testId} />
      </dd>
    </div>
  );
}

/** "All paid for Q3 2026" / "Paid 18 000,00 ₴ · 1 200,00 ₴ still to pay (Q1–Q4 2026)". */
function PaidLine({ paid }: { paid: SelectionPayments }) {
  return (
    <span className="block" data-testid="tax-selection-paid">
      {paid.due === 0 ? (
        <>Nothing due for {paid.label}</>
      ) : paid.outstanding === 0 ? (
        <>All paid for {paid.label}</>
      ) : (
        <>
          Paid <Money amount={paid.paid} currency="UAH" /> ·{" "}
          <Money amount={paid.outstanding} currency="UAH" className="font-medium text-foreground" data-testid="tax-selection-outstanding" />{" "}
          still to pay ({paid.label})
        </>
      )}
    </span>
  );
}

/** Figures + line-by-line tax for the selected months (recomputed on the client). */
export function TaxSummary({ settings, limit, aside, paymentStatus, esvOptional = false }: TaxSummaryProps) {
  const { calc, months, year, selectedIncomes } = useFreelanceSelection();
  const tax = settings.tax;
  const t = calc.totals;
  const incomeCount = calc.rows.reduce((n, r) => n + r.incomeCount, 0);
  const selection = describeSelection(months, year);
  const levy = levySummary(calc.months, tax);
  const empty = calc.months.length === 0;
  const foreign = currencyTotals(selectedIncomes).byCurrency.filter((c) => c.currency !== "UAH");
  const paid = paymentStatus ? selectionPayments(paymentStatus, calc.months) : null;

  return (
    <>
      <StatRow aria-label="Tax summary">
        <StatCard
          label="Freelance income"
          value={<Money amount={t.incomeUah} currency="UAH" tabular={false} />}
          hint={
            empty ? (
              "No months selected"
            ) : foreign.length ? (
              <span data-testid="income-before-exchange">
                {foreign.map((c, i) => (
                  <span key={c.currency}>
                    {i > 0 ? " + " : null}
                    <Money amount={c.amount} currency={c.currency} noDecimals />
                  </span>
                ))}
              </span>
            ) : (
              `${incomeCount} income${incomeCount === 1 ? "" : "s"}`
            )
          }
        />
        <StatCard
          label="Taxes for selection"
          value={<Money amount={t.total} currency="UAH" tabular={false} data-testid="tax-selection-total" />}
          hint={paid ? <PaidLine paid={paid} /> : undefined}
        />
        <StatCard
          label={`Income limit ${limit.year}`}
          value={<span className={cn(limit.exceeded && "text-negative")}>{formatPercent(limit.pct, 1)}</span>}
          hint={
            limit.exceeded
              ? `Over by ${formatMoney(subtractMoney(limit.incomeUah, limit.limit), "UAH")}`
              : `${formatMoney(limit.remainingUah, "UAH", { noDecimals: true })} left`
          }
        />
      </StatRow>

      {/* Container query: the page is narrower when the sidebar is expanded. */}
      <div className="@container">
        <div className="grid gap-8 @2xl:grid-cols-2">
          <SectionCard title="Tax" description={selection}>
            {empty ? (
              <EmptyState variant="plain" title="No months selected" />
            ) : (
              <dl className="divide-y text-sm">
                <Line label="Income" amount={t.incomeUah} testId="tax-income" />
                {t.excessUah > 0 ? <Line label="Above the annual limit" rate="15%" amount={t.excessUah} /> : null}
                <Line label="Single tax" rate={formatBp(calc.singleTaxRateBp)} amount={t.singleTax} testId="tax-single" />
                <Line label="Military levy" rate={levy.label} amount={t.levy} testId="tax-levy" />
                {t.esv !== 0 ? (
                  <Line
                    label={<span data-testid="tax-esv-label">ЄСВ{esvOptional ? <span className="ml-1.5 text-xs">optional</span> : null}</span>}
                    amount={t.esv}
                    testId="tax-esv"
                  />
                ) : null}
                <Line
                  total
                  label="Total"
                  rate={t.effectiveRate === null ? undefined : formatPercent(t.effectiveRate, 2)}
                  amount={t.total}
                  testId="tax-total"
                />
              </dl>
            )}
          </SectionCard>
          {aside}
        </div>
      </div>
    </>
  );
}
