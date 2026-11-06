"use client";

import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TransferDialog } from "@/components/forms/transfer-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatMoneyDisplay, Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { deleteTransfer } from "@/server/actions/transfers";
import type { TransferRow } from "@/server/queries";
import { useAccountsOptions } from "./accounts-options";
import { formatQuote, shortDate, transferQuote } from "./accounts-view";
import { ShowAllButton, usePaged } from "./show-more";

/** Transfers between own accounts (incl. currency sales), one line each: the latest few + "Show all", edit / delete. */
export function TransfersSection({ transfers }: { transfers: TransferRow[] }) {
  const paged = usePaged(transfers);

  return (
    <div id="transfers">
      {transfers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transfers yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Table className="[&_td]:py-1">
            <TableHeader className="sr-only">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.visible.map((t) => (
                <TransferTableRow key={t.id} row={t} />
              ))}
            </TableBody>
          </Table>
          <ShowAllButton paged={paged} />
        </div>
      )}
    </div>
  );
}

function TransferTableRow({ row }: { row: TransferRow }) {
  const options = useAccountsOptions();
  const quote = transferQuote(row.fromCurrency, row.toCurrency, row.fromAmount, row.toAmount);
  const fromName = row.fromAccount?.name ?? "Unknown account";
  const toName = row.toAccount?.name ?? "Unknown account";

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="w-20 text-muted-foreground tabular-nums">{shortDate(row.date, options.today)}</TableCell>
      <TableCell className="w-full max-w-0">
        <div className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate">
            {fromName} <span className="text-muted-foreground">→</span> {toName}
          </span>
          {row.note ? (
            <span className="truncate text-xs text-muted-foreground" title={row.note}>
              {row.note}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end sm:flex-row sm:items-baseline sm:justify-end sm:gap-2">
          <Money amount={row.fromAmount} currency={row.fromCurrency} className="font-medium" />
          {row.fromCurrency !== row.toCurrency ? (
            <span className="text-xs text-muted-foreground">
              <span className="sr-only">received </span>→ <Money amount={row.toAmount} currency={row.toCurrency} />
            </span>
          ) : null}
          {quote ? <span className="hidden text-xs text-muted-foreground tabular-nums sm:order-first sm:mr-1 sm:inline">{formatQuote(quote)}</span> : null}
        </div>
      </TableCell>
      <TableCell className="w-px">
        <TransferRowActions row={row} label={`${fromName} to ${toName}`} />
      </TableCell>
    </TableRow>
  );
}

/** Edit / Delete in one "…" menu (dialogs are controlled, outside the menu content). */
function TransferRowActions({ row, label }: { row: TransferRow; label: string }) {
  const options = useAccountsOptions();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const openChange = (which: "edit" | "delete") => (open: boolean) => setDialog(open ? which : null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Actions for transfer ${label}`}>
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("edit")}>Edit</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TransferDialog options={options} transfer={row} open={dialog === "edit"} onOpenChange={openChange("edit")} />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={openChange("delete")}
        destructive
        title="Delete this transfer?"
        description={`${label}, ${formatMoneyDisplay(row.fromAmount, row.fromCurrency)} on ${formatDate(row.date)}. Both account balances go back to what they were without it. This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          const res = await deleteTransfer(row.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Transfer deleted");
        }}
      />
    </>
  );
}
