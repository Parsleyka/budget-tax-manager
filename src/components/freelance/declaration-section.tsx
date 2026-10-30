"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDayMonth, formatMonth, formatQuarter, type ISODate, type QuarterKey } from "@/lib/dates";
import { sumMoney } from "@/lib/money";
import type { TaxDeadline } from "@/lib/tax/deadlines";
import type { QuarterlyDeclaration, QuarterPaymentStatus } from "@/lib/tax/engine";
import { esvApplies } from "@/lib/tax/payments";
import { TAX_KIND_LABELS, type Account } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isQuarterEnded, itemStatus, quarterStatus, sameDeadline, TAX_KINDS, type PaymentQuarterOption } from "./model";
import { RecordTaxPaymentDialog } from "./record-tax-payment-dialog";
import { StatusBadge } from "./status-badge";

export interface DeclarationSectionProps {
  declaration: QuarterlyDeclaration;
  statuses: QuarterPaymentStatus[];
  today: ISODate;
  /** Next actionable deadline (its date is emphasised). */
  next: TaxDeadline | null;
  /** Options for the "Record payment" dialog. */
  paymentQuarters: PaymentQuarterOption[];
  accounts: Account[];
  defaultAccountId: string;
  /**
   * "Include ЄСВ" on: minimum ЄСВ per quarter, shown as optional detail rows where no own ЄСВ is owed.
   * They never count towards a quarter's status (it stays computed from the real statuses).
   */
  optionalEsv?: Record<string, number>;
  /** Quarters shown with their per-tax detail from the start. */
  initialExpanded?: QuarterKey[];
}

const OPTIONAL_VIEW = { label: "Optional", tone: "muted" } as const;

/**
 * One row per quarter (due, paid, pay-by date, status, record payment); the single tax / levy / ЄСВ split
 * opens under it. Amounts are the declaration's cumulative accruals, so they can differ from the
 * selection's tax by a few kopecks.
 */
export function DeclarationSection({
  declaration,
  statuses,
  today,
  next,
  paymentQuarters,
  accounts,
  defaultAccountId,
  optionalEsv,
  initialExpanded,
}: DeclarationSectionProps) {
  const { year, limit } = declaration;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded));
  const toggle = (period: string) =>
    setExpanded((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(period)) nextSet.delete(period);
      else nextSet.add(period);
      return nextSet;
    });
  const optionalOf = (period: string) => optionalEsv?.[period] ?? 0;
  const rows = declaration.quarters.flatMap((q) => {
    const status = statuses.find((s) => s.period === q.period);
    return status ? [{ q, status, due: sumMoney(TAX_KINDS.map((k) => status.items[k].due)), paid: sumMoney(TAX_KINDS.map((k) => status.items[k].paid)) }] : [];
  });

  return (
    <SectionCard id="declarations" title="Declarations" description={String(year)}>
      {limit.forcedSwitchFrom ? (
        <p role="alert" className="pb-2 text-sm font-medium text-negative" data-testid="declaration-general-system">
          Income limit exceeded — general system from {formatDate(limit.forcedSwitchFrom)} (apply by {formatDate(limit.applicationDueBy as string)})
        </p>
      ) : null}
      <div className="@container">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Quarter</TableHead>
              <TableHead className="hidden text-right @2xl:table-cell">Income</TableHead>
              <TableHead className="text-right">Due</TableHead>
              <TableHead className="hidden text-right @lg:table-cell">Paid</TableHead>
              <TableHead className="hidden @xl:table-cell">Pay by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {rows.map(({ q, status, due, paid }) => {
            const label = formatQuarter(q.period);
            const open = expanded.has(q.period);
            const ended = isQuarterEnded(q.period, today);
            const payBy = status.items.single_tax.deadline;
            return (
              <TableBody key={q.period} className="border-b last:border-b-0" data-testid={`declaration-${q.period}`}>
                <TableRow className="hover:bg-transparent">
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground"
                        aria-expanded={open}
                        aria-label={`Details for ${label}`}
                        onClick={() => toggle(q.period)}
                      >
                        <ChevronRight aria-hidden className={cn("transition-transform", open && "rotate-90")} />
                      </Button>
                      <span className="font-medium">{label}</span>
                    </div>
                    {q.afterForcedSwitch ? (
                      <div className="pl-6 text-xs text-negative" data-testid="after-forced-switch">
                        General taxation system — only ЄСВ
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden text-right text-muted-foreground @2xl:table-cell">
                    <Money amount={q.incomeUah} currency="UAH" />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money amount={due} currency="UAH" />
                  </TableCell>
                  <TableCell className="hidden text-right @lg:table-cell">
                    <Money amount={paid} currency="UAH" className={cn(paid === 0 && "text-muted-foreground")} />
                  </TableCell>
                  <TableCell className="hidden @xl:table-cell">
                    <time dateTime={payBy} className={cn("tabular-nums", sameDeadline(next, "payment", q.period) ? "font-medium" : "text-muted-foreground")}>
                      {formatDayMonth(payBy)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={quarterStatus(status, today)} data-testid="quarter-status" />
                  </TableCell>
                  <TableCell className="text-right">
                    {/* Only where something is left to pay (or an optional ЄСВ is shown); the header menu records any other payment. */}
                    {due > paid || optionalOf(q.period) > 0 ? (
                      <RecordTaxPaymentDialog
                        quarters={paymentQuarters}
                        defaultPeriod={q.period}
                        accounts={accounts}
                        defaultAccountId={defaultAccountId}
                        today={today}
                        optionalEsv={optionalEsv}
                        trigger={
                          <Button size="sm" variant="ghost" className="text-muted-foreground" aria-label={`Record payment for ${label}`}>
                            Record<span className="hidden @xl:inline"> payment</span>
                          </Button>
                        }
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
                {open ? (
                  <>
                    {TAX_KINDS.filter((k) => k !== "esv" || esvApplies(status) || optionalOf(q.period) > 0).map((k) => {
                      const item = status.items[k];
                      // ЄСВ not owed but previewed ("Include ЄСВ"): the minimum as optional, never as due/overdue.
                      const optional = k === "esv" && !esvApplies(status);
                      return (
                        <TableRow key={k} className="text-sm hover:bg-transparent" data-optional={optional || undefined}>
                          <TableCell className="pl-6 text-muted-foreground">
                            {TAX_KIND_LABELS[k]}
                            {optional ? <span className="ml-1 text-xs">(optional)</span> : null}
                          </TableCell>
                          <TableCell className="hidden @2xl:table-cell" />
                          <TableCell className="text-right">
                            <Money amount={optional ? optionalOf(q.period) : item.due} currency="UAH" className={cn(optional && "text-muted-foreground")} />
                          </TableCell>
                          <TableCell className="hidden text-right @lg:table-cell">
                            <Money amount={item.paid} currency="UAH" className={cn(item.paid === 0 && "text-muted-foreground")} />
                            {item.creditApplied > 0 ? (
                              <div className="text-xs text-muted-foreground">
                                + <Money amount={item.creditApplied} currency="UAH" /> credit
                              </div>
                            ) : null}
                            {item.carriedForward > 0 && item.paid > 0 ? (
                              <div className="text-xs text-muted-foreground">
                                <Money amount={item.carriedForward} currency="UAH" /> carried over
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground tabular-nums @xl:table-cell">{formatDayMonth(item.deadline)}</TableCell>
                          <TableCell>
                            <StatusBadge status={optional ? OPTIONAL_VIEW : itemStatus(item, ended)} />
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      );
                    })}
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="pb-3 pl-6 text-xs whitespace-normal text-muted-foreground">
                        Declaration due {formatDate(q.deadlines.filing)}
                        {q.militaryServiceMonths.length > 0 ? (
                          <span data-testid="military-service-months">
                            {" "}
                            · military service ({q.militaryServiceMonths.map((m) => formatMonth(m)).join(", ")}): no single tax or levy
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  </>
                ) : null}
              </TableBody>
            );
          })}
          <TableFooter className="bg-transparent">
            <TableRow className="hover:bg-transparent">
              <TableCell className="font-medium">Year</TableCell>
              <TableCell className="hidden text-right text-muted-foreground @2xl:table-cell">
                <Money amount={declaration.totals.incomeUah} currency="UAH" />
              </TableCell>
              <TableCell className="text-right font-semibold">
                <Money amount={sumMoney(rows.map((r) => r.due))} currency="UAH" data-testid="declaration-year-due" />
              </TableCell>
              <TableCell className="hidden text-right @lg:table-cell">
                <Money amount={sumMoney(rows.map((r) => r.paid))} currency="UAH" />
              </TableCell>
              <TableCell className="hidden @xl:table-cell" />
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </SectionCard>
  );
}
