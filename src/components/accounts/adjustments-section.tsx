"use client";

import { DeleteButton } from "@/components/shared/delete-button";
import { formatMoneyDisplay, Money } from "@/components/shared/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { deleteAdjustment } from "@/server/actions/adjustments";
import type { AdjustmentRow } from "@/server/queries";
import { useAccountsOptions } from "./accounts-options";
import { shortDate } from "./accounts-view";
import { ShowAllButton, usePaged } from "./show-more";

/** History of "Update balance" corrections, one line each: the latest few + "Show all", delete. */
export function AdjustmentsSection({ adjustments }: { adjustments: AdjustmentRow[] }) {
  const options = useAccountsOptions();
  const paged = usePaged(adjustments);

  return (
    <div id="balance-updates">
      {adjustments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No balance updates yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Table className="[&_td]:py-1">
            <TableHeader className="sr-only">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paged.visible.map((a) => {
                const name = a.account?.name ?? "Unknown account";
                return (
                  <TableRow key={a.id} className="hover:bg-transparent">
                    <TableCell className="w-20 text-muted-foreground tabular-nums">{shortDate(a.date, options.today)}</TableCell>
                    <TableCell className="w-full max-w-0">
                      <div className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                        <span className="truncate">{name}</span>
                        {a.note ? (
                          <span className="truncate text-xs text-muted-foreground" title={a.note}>
                            {a.note}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Money amount={a.delta} currency={a.currency} signed colored className="font-medium" />
                    </TableCell>
                    <TableCell className="w-px">
                      <DeleteButton
                        id={a.id}
                        action={deleteAdjustment}
                        noun="balance update"
                        className="text-muted-foreground"
                        title="Delete this balance update?"
                        description={`${name} will change by ${formatMoneyDisplay(-a.delta, a.currency, { signed: true })} (the ${formatMoneyDisplay(a.delta, a.currency, { signed: true })} correction from ${formatDate(a.date)} is removed). This can't be undone.`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <ShowAllButton paged={paged} />
        </div>
      )}
    </div>
  );
}
