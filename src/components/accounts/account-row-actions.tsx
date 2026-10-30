"use client";

import { Ellipsis } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountDialog } from "@/components/forms/account-dialog";
import { AdjustBalanceDialog } from "@/components/forms/adjust-balance-dialog";
import { TransferDialog } from "@/components/forms/transfer-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatMoneyDisplay } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { Account } from "@/lib/types";
import { archiveAccount } from "@/server/actions/accounts";
import type { AccountUsage } from "@/server/queries";
import { useAccountsOptions } from "./accounts-options";
import { DeleteAccountDialog } from "./delete-account-dialog";

export interface AccountRowActionsProps {
  account: Account;
  usage: AccountUsage;
  /** Native balance (all movements). */
  balance: number;
  isDefault: boolean;
}

type OpenDialog = "adjust" | "edit" | "transfer" | "archive" | "delete" | null;

/**
 * Per-account "…" menu: Update balance, Transfer from here, Edit, Archive / Unarchive and Delete.
 * Dialogs live outside the menu content.
 */
export function AccountRowActions({ account, usage, balance, isDefault }: AccountRowActionsProps) {
  const options = useAccountsOptions();
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [pending, startTransition] = useTransition();
  const name = `“${account.name}”`;
  const openChange = (which: Exclude<OpenDialog, null>) => (open: boolean) => setDialog(open ? which : null);

  function unarchive() {
    startTransition(async () => {
      const res = await archiveAccount(account.id, false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${name} is back in your accounts`);
    });
  }

  return (
    <div className="flex shrink-0 items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`Actions for ${account.name}`}
            disabled={pending}
          >
            {pending ? <Spinner /> : <Ellipsis />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!account.archived ? (
            <>
              <DropdownMenuItem onSelect={() => setDialog("adjust")}>Update balance</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("transfer")}>Transfer from here</DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem onSelect={() => setDialog("edit")}>Edit</DropdownMenuItem>
          <DropdownMenuSeparator />
          {account.archived ? (
            <DropdownMenuItem onSelect={unarchive}>Unarchive</DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={isDefault} onSelect={() => setDialog("archive")}>
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("delete")}>
            Delete…
          </DropdownMenuItem>
          {isDefault ? (
            <DropdownMenuLabel className="max-w-52 text-xs font-normal text-muted-foreground">Main account</DropdownMenuLabel>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {!account.archived ? (
        <>
          <AdjustBalanceDialog
            open={dialog === "adjust"}
            onOpenChange={openChange("adjust")}
            options={options}
            accountId={account.id}
            lockAccount
            account={account}
            currentBalance={balance}
          />
          <TransferDialog
            open={dialog === "transfer"}
            onOpenChange={openChange("transfer")}
            options={options}
            defaults={{ fromAccountId: account.id }}
          />
          <ConfirmDialog
            open={dialog === "archive"}
            onOpenChange={openChange("archive")}
            title={`Archive ${name}?`}
            description={
              balance !== 0
                ? `It disappears from pickers and forms; its history stays. Its balance of ${formatMoneyDisplay(balance, account.currency)} keeps counting toward your totals until it's zero.`
                : "It disappears from pickers and forms; its history stays. You can unarchive it any time with “Show archived”."
            }
            confirmLabel="Archive"
            onConfirm={async () => {
              const res = await archiveAccount(account.id, true);
              if (!res.ok) {
                toast.error(res.error);
                return false;
              }
              toast.success(`${name} archived`);
            }}
          />
        </>
      ) : null}
      <AccountDialog open={dialog === "edit"} onOpenChange={openChange("edit")} account={account} currencyLocked={usage.total > 0} />
      <DeleteAccountDialog
        open={dialog === "delete"}
        onOpenChange={openChange("delete")}
        account={account}
        usage={usage}
        isDefault={isDefault}
        balance={balance}
      />
    </div>
  );
}
