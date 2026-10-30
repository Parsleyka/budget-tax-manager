"use client";

import { Ellipsis, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { AccountDialog } from "@/components/forms/account-dialog";
import { AdjustBalanceDialog } from "@/components/forms/adjust-balance-dialog";
import { TransferDialog } from "@/components/forms/transfer-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useAccountsOptions } from "./accounts-options";
import { ARCHIVED_PARAM } from "./accounts-view";

type MenuDialog = "transfer" | "balance";

/**
 * Page actions: Add account (primary) + a "…" menu with Transfer, Update balance and Show / Hide archived
 * (`?archived=1`, other search params kept). The menu's dialogs are controlled.
 */
export function AccountsHeaderActions({ showArchived, archivedCount }: { showArchived: boolean; archivedCount: number }) {
  const options = useAccountsOptions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<MenuDialog | null>(null);
  const openChange = (which: MenuDialog) => (next: boolean) => setOpen(next ? which : null);

  function toggleArchived() {
    const params = new URLSearchParams(searchParams.toString());
    if (showArchived) params.delete(ARCHIVED_PARAM);
    else params.set(ARCHIVED_PARAM, "1");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <>
      <AccountDialog
        trigger={
          <Button>
            <Plus aria-hidden /> Add account
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions" disabled={pending}>
            {pending ? <Spinner /> : <Ellipsis aria-hidden />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={options.accounts.length < 2} onSelect={() => setOpen("transfer")}>
            Transfer
          </DropdownMenuItem>
          <DropdownMenuItem disabled={options.accounts.length === 0} onSelect={() => setOpen("balance")}>
            Update balance
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!showArchived && archivedCount === 0} onSelect={toggleArchived}>
            {showArchived ? "Hide archived" : `Show archived${archivedCount > 0 ? ` (${archivedCount})` : ""}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TransferDialog options={options} open={open === "transfer"} onOpenChange={openChange("transfer")} />
      <AdjustBalanceDialog options={options} open={open === "balance"} onOpenChange={openChange("balance")} />
    </>
  );
}
