"use client";

import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DebtDialog, type DebtDialogOptions } from "@/components/forms/debt-dialog";
import { DebtRepaymentDialog } from "@/components/forms/debt-repayment-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { formatMoneyDisplay, Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/dates";
import { dueLabel, type DebtDueState } from "@/lib/debts";
import { cn } from "@/lib/utils";
import { deleteDebt, deleteDebtRepayment } from "@/server/actions/debts";
import type { DebtRow } from "@/server/queries";

export interface DebtItemProps {
  row: DebtRow;
  options: DebtDialogOptions;
  people: readonly string[];
}

/** Due state → text color; a debt without a due date shows none. */
const DUE_TONE: Partial<Record<DebtDueState, string>> = {
  overdue: "text-negative",
  "due-today": "text-warning",
  "due-soon": "text-warning",
  upcoming: "text-muted-foreground",
  settled: "text-muted-foreground",
};

/** One debt row: who · when · outstanding, "Paid back" and a "…" menu (edit, repayments, delete). */
export function DebtItem({ row, options, people }: DebtItemProps) {
  const { debt, status } = row;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [repaying, setRepaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lent = debt.direction === "lent";
  const repayLabel = lent ? "Got money back" : "Paid back";
  const amountText = formatMoneyDisplay(debt.amount, debt.currency);
  const due = DUE_TONE[status.dueState];

  return (
    <li data-testid="debt-item" data-counterparty={debt.counterparty}>
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <div className="flex min-w-0 items-center gap-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="truncate font-medium">{debt.counterparty}</span>
              {due ? (
                <span className={cn("text-xs", due)} data-due-state={status.dueState}>
                  {dueLabel(status)}
                </span>
              ) : null}
            </span>
            <span className="truncate text-xs text-muted-foreground" title={debt.note ?? undefined}>
              {lent ? "Lent" : "Borrowed"} {formatDate(debt.date)}
              {status.settled && status.settledOn ? ` · settled ${formatDate(status.settledOn)}` : ""}
              {debt.note ? ` · ${debt.note}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <Money amount={status.settled ? debt.amount : status.outstanding} currency={debt.currency} className="font-medium" data-testid="debt-outstanding" />
            {!status.settled && status.repaid > 0 ? <span className="text-xs text-muted-foreground">of {amountText}</span> : null}
          </div>
          {/* Phones: in the "…" menu instead. */}
          {!status.settled ? (
            <Button size="sm" variant="ghost" className="hidden text-muted-foreground sm:inline-flex" onClick={() => setRepaying(true)}>
              {repayLabel}
            </Button>
          ) : null}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`More actions for debt with ${debt.counterparty}`} className="text-muted-foreground">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!status.settled ? (
                <DropdownMenuItem className="sm:hidden" onSelect={() => setRepaying(true)}>
                  {repayLabel}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setEditing(true)}>Edit</DropdownMenuItem>
              {row.repayments.length > 0 ? (
                <DropdownMenuItem onSelect={() => setHistoryOpen(!historyOpen)}>
                  {historyOpen ? "Hide repayments" : `Repayments (${row.repayments.length})`}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CollapsibleContent>
          <ul className="mb-3 flex flex-col divide-y border-l pl-4 text-sm" aria-label={`Repayments for ${debt.counterparty}`}>
            {row.repayments.map((r) => (
              <li key={r.id} className="flex min-w-0 items-center gap-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="tabular-nums">{formatDate(r.date)}</span>
                  <span className="truncate text-xs text-muted-foreground" data-testid="repayment-account">
                    {r.account ? `${lent ? "into" : "from"} ${r.account.name}` : r.accountId ? "Unknown account" : "No account"}
                    {r.note ? ` · ${r.note}` : ""}
                  </span>
                </div>
                <div className="flex flex-col items-end">
                  <Money amount={r.amount} currency={debt.currency} />
                  {r.account && r.accountAmount !== undefined ? (
                    <span className="text-xs text-muted-foreground">
                      = <Money amount={r.accountAmount} currency={r.account.currency} />
                    </span>
                  ) : null}
                </div>
                <DeleteButton
                  id={r.id}
                  action={(id) => deleteDebtRepayment(debt.id, id)}
                  noun="repayment"
                  ariaLabel={`Delete repayment of ${formatMoneyDisplay(r.amount, debt.currency)} on ${formatDate(r.date)}`}
                  title="Delete this repayment?"
                  description={`${formatMoneyDisplay(r.amount, debt.currency)} on ${formatDate(r.date)}. The amount becomes outstanding again${
                    r.account ? `, and ${r.account.name} goes back by it` : ""
                  }.`}
                  className="text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>

      {!status.settled ? (
        <DebtRepaymentDialog options={options} debt={debt} outstanding={status.outstanding} open={repaying} onOpenChange={setRepaying} />
      ) : null}
      <DebtDialog options={options} debt={debt} people={people} open={editing} onOpenChange={setEditing} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete the debt with ${debt.counterparty}?`}
        description={`${lent ? "Lent" : "Borrowed"} ${amountText} on ${formatDate(debt.date)}${
          debt.repayments.length ? `, with ${debt.repayments.length} repayment${debt.repayments.length === 1 ? "" : "s"}` : ""
        }.${debt.repayments.some((r) => r.accountId) ? " Account balances changed by its repayments go back too." : ""} This can't be undone.`}
        onConfirm={async () => {
          const res = await deleteDebt(debt.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Debt deleted");
        }}
      />
    </li>
  );
}
