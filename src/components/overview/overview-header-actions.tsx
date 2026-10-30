"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useState } from "react";
import { AdjustBalanceDialog } from "@/components/forms/adjust-balance-dialog";
import { ExpenseDialog } from "@/components/forms/expense-dialog";
import { IncomeDialog } from "@/components/forms/income-dialog";
import { TransferDialog } from "@/components/forms/transfer-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { FormOptions } from "@/server/queries";

type MenuDialog = "salary" | "freelance" | "transfer" | "balance";

/**
 * "Add spending" (primary) + a "…" menu with the other everyday actions. The menu's dialogs are
 * controlled: they open after the menu has closed.
 */
export function OverviewHeaderActions({ options }: { options: FormOptions }) {
  const [open, setOpen] = useState<MenuDialog | null>(null);
  const openChange = (which: MenuDialog) => (next: boolean) => setOpen(next ? which : null);
  return (
    <>
      <ExpenseDialog
        options={options}
        trigger={
          <Button>
            <Plus aria-hidden /> Add spending
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen("salary")}>Add salary</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("freelance")}>Add freelance income</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("transfer")}>Transfer</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("balance")}>Update balance</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IncomeDialog mode="salary" options={options} open={open === "salary"} onOpenChange={openChange("salary")} />
      <IncomeDialog mode="freelance" options={options} open={open === "freelance"} onOpenChange={openChange("freelance")} />
      <TransferDialog options={options} open={open === "transfer"} onOpenChange={openChange("transfer")} />
      <AdjustBalanceDialog
        options={options}
        accountId={options.defaultActiveAccountId}
        open={open === "balance"}
        onOpenChange={openChange("balance")}
      />
    </>
  );
}
