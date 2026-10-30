"use client";

import { AdjustBalanceDialog } from "@/components/forms/adjust-balance-dialog";
import { DeleteButton } from "@/components/shared/delete-button";
import { formatMoneyDisplay, Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { deleteAdjustment } from "@/server/actions/adjustments";
import type { AdjustmentRow } from "@/server/queries";
import { useAccountsOptions } from "./accounts-options";
import { shortDate } from "./accounts-view";
import { ShowAllButton, usePaged } from "./show-more";

/** History of "Update balance" corrections (date, account, change, note): the latest few + "Show all", delete. */
export function AdjustmentsSection({ adjustments }: { adjustments: AdjustmentRow[] }) {
  const options = useAccountsOptions();
  const paged = usePaged(adjustments);

  return (
    <SectionCard
      id="balance-updates"
      title="Balance updates"
      action={
        <AdjustBalanceDialog
          options={options}
          trigger={
            <Button size="sm" variant="ghost" disabled={options.accounts.length === 0}>
              Update balance
            </Button>
          }
        />
      }
    >
      {adjustments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No balance updates yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <Table>
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
                    <TableCell className="w-20 align-top text-muted-foreground tabular-nums">{shortDate(a.date, options.today)}</TableCell>
                    <TableCell className="w-full max-w-0 align-top">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">{name}</span>
                        {a.note ? (
                          <span className="truncate text-xs text-muted-foreground" title={a.note}>
                            {a.note}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Money amount={a.delta} currency={a.currency} signed colored className="font-medium" />
                    </TableCell>
                    <TableCell className="w-px align-top">
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
    </SectionCard>
  );
}
