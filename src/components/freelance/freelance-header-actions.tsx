"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useState } from "react";
import { IncomeDialog, type IncomeDialogOptions } from "@/components/forms/income-dialog";
import { TransferDialog, type TransferDialogOptions } from "@/components/forms/transfer-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Account } from "@/lib/types";
import type { ISODate, QuarterKey } from "@/lib/dates";
import type { PaymentQuarterOption } from "./model";
import { RecordTaxPaymentDialog } from "./record-tax-payment-dialog";

export interface FreelanceHeaderActionsProps {
  /** What the income and transfer dialogs need (a `Pick` of `getFormOptions()`). */
  options: IncomeDialogOptions & TransferDialogOptions;
  payment: {
    quarters: PaymentQuarterOption[];
    accounts: Account[];
    defaultAccountId: string;
    today: ISODate;
    optionalEsv?: Record<string, number>;
  };
  defaultPeriod: QuarterKey | null;
}

/** "Add freelance income" (primary) + a "…" menu: record a tax payment, sell currency from a ФОП account. */
export function FreelanceHeaderActions({ options, payment, defaultPeriod }: FreelanceHeaderActionsProps) {
  // Dialogs opened from menu items are controlled (the menu closes first).
  const [open, setOpen] = useState<"payment" | "sell" | null>(null);
  const control = (which: "payment" | "sell") => ({
    open: open === which,
    onOpenChange: (o: boolean) => setOpen(o ? which : null),
  });
  const fromId = options.defaultFreelancerAccountIds.USD ?? options.defaultFreelancerAccountIds.EUR;
  return (
    <>
      <IncomeDialog
        mode="freelance"
        options={options}
        trigger={
          <Button>
            <Plus aria-hidden /> Add freelance income
          </Button>
        }
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen("payment")}>Record tax payment</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setOpen("sell")}>Sell currency</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RecordTaxPaymentDialog {...payment} defaultPeriod={defaultPeriod} {...control("payment")} />
      <TransferDialog
        options={options}
        defaults={{ fromAccountId: fromId, toAccountId: options.defaultActiveAccountId }}
        {...control("sell")}
      />
    </>
  );
}
