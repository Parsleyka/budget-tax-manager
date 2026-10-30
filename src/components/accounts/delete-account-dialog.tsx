"use client";

import Link from "next/link";
import type * as React from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatMoneyDisplay } from "@/components/shared/money";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/types";
import { archiveAccount, deleteAccount } from "@/server/actions/accounts";
import type { AccountUsage } from "@/server/queries";
import { deleteBlock, recordCount } from "./accounts-view";

export interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account;
  usage: AccountUsage;
  isDefault: boolean;
  balance: number;
}

const USAGE_LINES: { key: keyof Omit<AccountUsage, "total">; one: string; many: string }[] = [
  { key: "incomes", one: "income", many: "incomes" },
  { key: "expenses", one: "spending", many: "spendings" },
  { key: "transfers", one: "transfer", many: "transfers" },
  { key: "adjustments", one: "balance update", many: "balance updates" },
];

/**
 * Delete flow for one account. Deletion is only possible when nothing references the account and it
 * isn't the main account (same rule as the server's `canDeleteAccount`). Otherwise the dialog explains
 * why and offers to archive the account instead.
 */
export function DeleteAccountDialog({ open, onOpenChange, account, usage, isDefault, balance }: DeleteAccountDialogProps) {
  const block = deleteBlock({ isDefault, usage });
  const name = `“${account.name}”`;

  if (!block) {
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={onOpenChange}
        destructive
        title={`Delete ${name}?`}
        description={
          balance !== 0
            ? `It has no records. Its opening balance of ${formatMoneyDisplay(balance, account.currency)} will stop counting toward your totals. This can't be undone.`
            : "It has no records, so nothing else changes. This can't be undone."
        }
        confirmLabel="Delete account"
        onConfirm={async () => {
          const res = await deleteAccount(account.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success(`${name} deleted`);
        }}
      />
    );
  }

  if (block.reason === "default") {
    return (
      <InfoDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`${name} can't be deleted`}
        description="It's your main account: salary and spendings go to it by default, and it holds your Active balance. Pick another main account in Settings first."
        action={
          <Button asChild>
            <Link href="/settings?tab=general">Open Settings</Link>
          </Button>
        }
      />
    );
  }

  const usageList = (
    <ul className="flex flex-col gap-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm" aria-label="Records that use this account">
      {USAGE_LINES.filter((l) => block.usage[l.key] > 0).map((l) => (
        <li key={l.key} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{block.usage[l.key] === 1 ? l.one : l.many}</span>
          <span className="font-medium tabular-nums">{block.usage[l.key]}</span>
        </li>
      ))}
    </ul>
  );

  if (account.archived) {
    return (
      <InfoDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`${name} can't be deleted`}
        description={`It's used by ${recordCount(block.usage.total)}, and deleting it would leave them without an account. It's already archived, so it stays out of pickers and forms.`}
      >
        {usageList}
      </InfoDialog>
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${name} can't be deleted`}
      description={`It's used by ${recordCount(block.usage.total)}, and deleting it would leave them without an account. Archive it instead: it disappears from pickers and forms, its history stays${balance !== 0 ? ", and its balance keeps counting toward your totals" : ""}.`}
      confirmLabel="Archive instead"
      onConfirm={async () => {
        const res = await archiveAccount(account.id, true);
        if (!res.ok) {
          toast.error(res.error);
          return false;
        }
        toast.success(`${name} archived`);
      }}
    >
      {usageList}
    </ConfirmDialog>
  );
}

/** A read-only explanation with a Close button (plus an optional extra `action` button). */
function InfoDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          {action}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
