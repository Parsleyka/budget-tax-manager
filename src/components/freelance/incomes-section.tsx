"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { IncomeDialog, type IncomeDialogOptions } from "@/components/forms/income-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDayMonth } from "@/lib/dates";
import { formatRate } from "@/lib/money";
import { cn } from "@/lib/utils";
import { deleteIncome } from "@/server/actions/incomes";
import type { FreelanceIncomeRow } from "@/server/queries";
import { currencyTotals, describeSelection, inMonths } from "./model";
import { useFreelanceSelection } from "./selection-context";

export interface IncomesSectionProps {
  /** Freelance incomes of the year (oldest first). */
  rows: FreelanceIncomeRow[];
  options: IncomeDialogOptions;
}

/** "44,9801" (NBU) / "44,9000 manual". */
function RateText({ row }: { row: FreelanceIncomeRow }) {
  return (
    <span className="tabular-nums">
      {formatRate(row.rate)}
      {row.rateSource === "manual" ? (
        <span className="text-muted-foreground" title="Entered manually (the NBU rate was unavailable)">
          {" "}
          manual
        </span>
      ) : null}
    </span>
  );
}

/** Edit / delete menu for one income (dialogs rendered outside the menu content). */
function IncomeRowActions({ row, options }: { row: FreelanceIncomeRow; options: IncomeDialogOptions }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Actions for the income of ${formatDate(row.date)}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IncomeDialog open={editing} onOpenChange={setEditing} options={options} income={row} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title="Delete this freelance income?"
        description="It is removed from the account balance and from the tax calculation. This can't be undone."
        onConfirm={async () => {
          const res = await deleteIncome(row.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Income deleted");
        }}
      />
    </>
  );
}

/** Freelance incomes of the selected months, before (original currency) and after (UAH) exchange. */
export function IncomesSection({ rows, options }: IncomesSectionProps) {
  const { months, year } = useFreelanceSelection();
  const selected = inMonths(rows, months);
  const totals = currencyTotals(selected);
  const hasFees = selected.some((r) => !!r.fee);

  return (
    <SectionCard title="Freelance income" description={describeSelection(months, year)}>
      {rows.length === 0 ? (
        <EmptyState variant="plain" title={`No freelance income in ${year}`} />
      ) : selected.length === 0 ? (
        <EmptyState variant="plain" title="No freelance income in the selected months" />
      ) : (
        // Container queries (not viewport breakpoints): the section is narrower when the sidebar is open.
        <div className="@container">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="hidden @xl:table-cell">Date</TableHead>
                {/* Below @xl the Date column is hidden, so Client is the first visible column: align it with the title. */}
                <TableHead className="@max-xl:pl-0">Client</TableHead>
                <TableHead className="hidden text-right @xl:table-cell">Amount</TableHead>
                <TableHead className="hidden text-right @xl:table-cell">NBU rate</TableHead>
                {hasFees ? <TableHead className="hidden text-right @3xl:table-cell">Fee</TableHead> : null}
                <TableHead className="text-right">In UAH</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="hidden text-muted-foreground tabular-nums @xl:table-cell">{formatDayMonth(row.date)}</TableCell>
                  <TableCell className="@max-xl:pl-0">
                    <div className="max-w-40 @xl:max-w-48 @3xl:max-w-64">
                      <div className={cn("truncate", !row.counterparty && "text-muted-foreground")} title={row.counterparty}>
                        {row.counterparty ?? "No client"}
                      </div>
                      {row.note ? (
                        <div className="truncate text-xs text-muted-foreground" title={row.note}>
                          {row.note}
                        </div>
                      ) : null}
                      <div className="text-xs text-muted-foreground tabular-nums @xl:hidden">{formatDayMonth(row.date)}</div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right @xl:table-cell">
                    <Money amount={row.amount} currency={row.currency} />
                  </TableCell>
                  <TableCell className="hidden text-right @xl:table-cell">
                    {row.currency === "UAH" ? <span className="text-muted-foreground">—</span> : <RateText row={row} />}
                  </TableCell>
                  {hasFees ? (
                    <TableCell className="hidden text-right @3xl:table-cell">
                      {row.fee ? (
                        <Money amount={row.fee} currency={row.currency} className="text-muted-foreground" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <Money amount={row.amountUah} currency="UAH" className="font-medium" />
                    {row.currency !== "UAH" ? (
                      <div className="flex flex-col items-end text-xs text-muted-foreground @xl:hidden">
                        <Money amount={row.amount} currency={row.currency} />
                        <span>
                          @ <RateText row={row} />
                        </span>
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="w-10">
                    <IncomeRowActions row={row} options={options} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="bg-transparent">
              <TableRow className="hover:bg-transparent">
                <TableCell className="hidden font-medium @xl:table-cell">Total</TableCell>
                <TableCell className="font-medium @max-xl:pl-0">
                  <span className="@xl:hidden">Total </span>
                  <span className="font-normal text-muted-foreground">
                    {selected.length} income{selected.length === 1 ? "" : "s"}
                  </span>
                </TableCell>
                <TableCell className="hidden text-right align-top @xl:table-cell">
                  <div className="flex flex-col items-end gap-0.5">
                    {totals.byCurrency.map((c) => (
                      <Money key={c.currency} amount={c.amount} currency={c.currency} />
                    ))}
                  </div>
                </TableCell>
                <TableCell className="hidden @xl:table-cell" />
                {hasFees ? <TableCell className="hidden @3xl:table-cell" /> : null}
                <TableCell className="text-right align-top font-semibold">
                  <Money amount={totals.totalUah} currency="UAH" data-testid="freelance-total-uah" />
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </SectionCard>
  );
}
