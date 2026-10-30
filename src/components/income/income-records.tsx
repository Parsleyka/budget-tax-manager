"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { IncomeDialog, type IncomeDialogOptions } from "@/components/forms/income-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { INCOME_KIND_LABELS } from "@/lib/labels";
import { CURRENCY_SYMBOL, formatRate } from "@/lib/money";
import { useContainerWide } from "@/hooks/use-container-wide";
import { cn } from "@/lib/utils";
import { deleteIncome } from "@/server/actions/incomes";
import type { IncomeKindFilter, IncomeRow } from "@/server/queries";
import {
  counterpartyHeader,
  describeIncome,
  incomeNoun,
  incomeTitle,
  pluralIncomes,
  summarizeIncomeRows,
  type IncomeRowsSummary,
} from "./income-view";

export interface IncomeRecordsProps {
  /** Rows from the loader (already filtered by period + kind, newest first). Non-empty. */
  rows: IncomeRow[];
  kind: IncomeKindFilter;
  /** For the edit dialog (a `Pick` of `getFormOptions()`). */
  options: IncomeDialogOptions;
  /** Screen-reader caption for the table / list (e.g. "Freelance income, 1 Jan – 15 Oct 2026"). */
  caption: string;
  /**
   * Totals for the footer when `rows` is only the first page of the period (the page slices long
   * lists, see `?limit=`). Default: computed from `rows`.
   */
  summary?: IncomeRowsSummary;
}

interface Columns {
  /** Original amount (before exchange): when something is not in UAH, always on the Freelance tab. */
  amount: boolean;
  /** NBU rate as its own column: Freelance tab only (elsewhere it sits muted under the amount). */
  rate: boolean;
  /** Kind in the secondary line (the All tab mixes salary and freelance). */
  kind: boolean;
}

type RowHandler = (row: IncomeRow) => void;

/**
 * The income list: a table when the section is ≥ 40rem wide, cards below that. Owns ONE edit dialog and
 * ONE delete confirmation for all rows (the row menus only pick the record).
 */
export function IncomeRecords({ rows, kind, options, caption, summary: allSummary }: IncomeRecordsProps) {
  const [editRow, setEditRow] = useState<IncomeRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<IncomeRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const summary = allSummary ?? summarizeIncomeRows(rows);
  // @2xl = 42rem: the table/cards switch point. Both render until measured (SSR), then only the visible one.
  const [containerRef, wide] = useContainerWide(42);
  const columns: Columns = {
    amount: kind === "freelance" || (kind === "all" && summary.hasForeign),
    rate: kind === "freelance",
    kind: kind === "all",
  };

  const onEdit: RowHandler = (row) => {
    setEditRow(row);
    setEditOpen(true);
  };
  const onDelete: RowHandler = (row) => {
    setDeleteRow(row);
    setDeleteOpen(true);
  };

  return (
    <>
      {/* Container queries: the layout follows the card's width (the sidebar may be expanded), not the viewport. */}
      <div className="@container" ref={containerRef}>
        {wide !== false ? (
          <div className="hidden @2xl:block" data-testid="income-table">
            <IncomeTable rows={rows} kind={kind} columns={columns} summary={summary} caption={caption} onEdit={onEdit} onDelete={onDelete} />
          </div>
        ) : null}
        {wide !== true ? (
          <div className="@2xl:hidden" data-testid="income-cards">
            <IncomeCards rows={rows} columns={columns} summary={summary} caption={caption} onEdit={onEdit} onDelete={onDelete} />
          </div>
        ) : null}
      </div>

      {editRow ? (
        <IncomeDialog key={editRow.id} open={editOpen} onOpenChange={setEditOpen} options={options} income={editRow} />
      ) : null}

      {deleteRow ? (
        <ConfirmDialog
          key={deleteRow.id}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          destructive
          title={`Delete this ${incomeNoun(deleteRow.kind)}?`}
          description={deleteDescription(deleteRow)}
          confirmLabel="Delete"
          onConfirm={async () => {
            const res = await deleteIncome(deleteRow.id);
            if (!res.ok) {
              toast.error(res.error);
              return false;
            }
            toast.success(deleteRow.kind === "salary" ? "Salary deleted" : "Freelance income deleted");
          }}
        />
      ) : null}
    </>
  );
}

function deleteDescription(row: IncomeRow): string {
  const what = describeIncome(row);
  const from = row.account ? ` from ${row.account.name}` : "";
  const tax = row.kind === "freelance" ? " It also drops out of your tax calculation." : "";
  return `The ${what} will be removed${from}.${tax} This can't be undone.`;
}

// ------------------------------------------------------------------ desktop table

interface ViewProps {
  rows: IncomeRow[];
  columns: Columns;
  summary: IncomeRowsSummary;
  caption: string;
  onEdit: RowHandler;
  onDelete: RowHandler;
}

function IncomeTable({ rows, kind, columns, summary, caption, onEdit, onDelete }: ViewProps & { kind: IncomeKindFilter }) {
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-28">Date</TableHead>
          <TableHead>{counterpartyHeader(kind)}</TableHead>
          {columns.amount ? <TableHead className="text-right">Amount</TableHead> : null}
          {columns.rate ? <TableHead className="text-right">NBU rate</TableHead> : null}
          <TableHead className="text-right">{columns.amount ? "In UAH" : "Amount"}</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} data-income-id={row.id}>
            <TableCell className="text-muted-foreground tabular-nums">{formatDate(row.date)}</TableCell>
            {/* Takes the leftover width and truncates (w-full + max-w-0), never narrower than min-w-36. */}
            <TableCell className="w-full max-w-0 min-w-36">
              <div className="flex min-w-0 flex-col">
                <span className={cn("truncate", !row.counterparty && "text-muted-foreground")} title={row.counterparty}>
                  {incomeTitle(row)}
                </span>
                <SecondaryLine row={row} kind={columns.kind} />
              </div>
            </TableCell>
            {columns.amount ? (
              <TableCell className="text-right align-top">
                <div className="flex flex-col items-end">
                  {row.currency !== "UAH" ? <Money amount={row.amount} currency={row.currency} /> : null}
                  {!columns.rate && row.currency !== "UAH" ? (
                    <span className="text-xs text-muted-foreground">
                      <RateText row={row} />
                    </span>
                  ) : null}
                </div>
              </TableCell>
            ) : null}
            {columns.rate ? (
              <TableCell className="text-right align-top">
                {row.currency === "UAH" ? <Dash /> : <RateText row={row} />}
              </TableCell>
            ) : null}
            <TableCell className="text-right align-top">
              <div className="flex flex-col items-end">
                <Money amount={row.amountUah} currency="UAH" className="font-medium" />
                {row.fee ? (
                  <span className="text-xs text-muted-foreground">
                    after fee <Money amount={row.receivedUah} currency="UAH" />
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="align-top">
              <RowActions row={row} onEdit={onEdit} onDelete={onDelete} className="justify-end" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter className="bg-transparent">
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={2} className="font-medium">
            Total <span className="font-normal text-muted-foreground">· {pluralIncomes(summary.count)}</span>
          </TableCell>
          {columns.amount ? (
            <TableCell className="text-right align-top">
              <CurrencyTotals summary={summary} />
            </TableCell>
          ) : null}
          {columns.rate ? <TableCell /> : null}
          <TableCell className="text-right align-top">
            <div className="flex flex-col items-end">
              <Money amount={summary.totalUah} currency="UAH" className="font-semibold" />
              {summary.hasFees ? (
                <span className="text-xs font-normal text-muted-foreground">
                  after fees <Money amount={summary.receivedUah} currency="UAH" />
                </span>
              ) : null}
            </div>
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** Kind (All tab) · account · note, muted under the source. */
function SecondaryLine({ row, kind }: { row: IncomeRow; kind: boolean }) {
  const parts = [kind ? INCOME_KIND_LABELS[row.kind] : null, row.account?.name ?? "Unknown account", row.note || null].filter(Boolean);
  return (
    <span className="truncate text-xs text-muted-foreground" title={row.note}>
      {parts.join(" · ")}
    </span>
  );
}

/** "44,9801" (NBU) / "44,9000 manual". */
function RateText({ row }: { row: IncomeRow }) {
  const manual = row.rateSource === "manual";
  return (
    <span
      className="tabular-nums"
      title={`${manual ? "Manual rate" : "NBU rate"} for ${formatDate(row.date)}: 1 ${CURRENCY_SYMBOL[row.currency]} = ${formatRate(row.rate)} ₴`}
    >
      {formatRate(row.rate)}
      {manual ? <span className="text-muted-foreground"> manual</span> : null}
    </span>
  );
}

function CurrencyTotals({ summary }: { summary: IncomeRowsSummary }) {
  const items = summary.byCurrency.filter((c) => c.amount > 0 && c.currency !== "UAH");
  if (!items.length) return null;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {items.map((c) => (
        <Money key={c.currency} amount={c.amount} currency={c.currency} className="font-medium" />
      ))}
    </div>
  );
}

function Dash() {
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">none</span>
    </span>
  );
}

/** One "…" menu per row: Edit · Delete. */
function RowActions({ row, onEdit, onDelete, className }: { row: IncomeRow; onEdit: RowHandler; onDelete: RowHandler; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Actions for ${describeIncome(row)}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(row)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ------------------------------------------------------------------ mobile cards

function IncomeCards({ rows, columns, summary, caption, onEdit, onDelete }: ViewProps) {
  const foreign = summary.byCurrency.filter((c) => c.currency !== "UAH");
  return (
    <div className="flex flex-col">
      <ul className="divide-y border-b" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.id} data-income-id={row.id} className="flex items-start justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("truncate text-sm", !row.counterparty && "text-muted-foreground")}>{incomeTitle(row)}</span>
              <span className="truncate text-xs text-muted-foreground" title={row.note}>
                {[formatDate(row.date), columns.kind ? INCOME_KIND_LABELS[row.kind] : null, row.account?.name ?? null, row.note || null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <div className="flex shrink-0 items-start gap-1">
              <div className="flex flex-col items-end gap-0.5 text-right">
                <Money amount={row.amountUah} currency="UAH" className="text-sm font-medium" />
                {row.currency !== "UAH" ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    <Money amount={row.amount} currency={row.currency} /> × <RateText row={row} />
                  </span>
                ) : null}
                {row.fee ? (
                  <span className="text-xs text-muted-foreground">
                    after fee <Money amount={row.receivedUah} currency="UAH" />
                  </span>
                ) : null}
              </div>
              <RowActions row={row} onEdit={onEdit} onDelete={onDelete} className="-mt-1 -mr-1.5" />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-0.5 py-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium whitespace-nowrap">
            Total <span className="font-normal text-muted-foreground">· {pluralIncomes(summary.count)}</span>
          </span>
          <Money amount={summary.totalUah} currency="UAH" className="font-semibold" />
        </div>
        {columns.amount && foreign.length ? (
          <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span>Before exchange</span>
            <span className="text-right">
              {foreign.map((c, i) => (
                <span key={c.currency}>
                  {i > 0 ? " + " : ""}
                  <Money amount={c.amount} currency={c.currency} />
                </span>
              ))}
            </span>
          </div>
        ) : null}
        {summary.hasFees ? (
          <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <span>After fees</span>
            <Money amount={summary.receivedUah} currency="UAH" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
