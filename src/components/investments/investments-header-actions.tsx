"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useState } from "react";
import { AccountDialog } from "@/components/forms/account-dialog";
import { InvestmentFlowDialog, type InvestmentDialogOptions } from "@/components/forms/investment-flow-dialog";
import { ValuationDialog } from "@/components/forms/valuation-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TrackedGroup } from "@/lib/investments";

/** Page actions: deposit / withdrawal (primary); update value and add an account in the "…" menu. */
export function InvestmentsHeaderActions({
  options,
  current,
}: {
  options: InvestmentDialogOptions;
  current: Record<string, { value: number; netDeposited: number }>;
}) {
  const none = options.investmentAccounts.length === 0;
  // Dialogs opened from menu items are controlled (the menu closes first).
  const [valuing, setValuing] = useState(false);
  const [adding, setAdding] = useState<TrackedGroup | null>(null);
  return (
    <>
      <InvestmentFlowDialog
        options={options}
        trigger={
          <Button disabled={none}>
            <Plus aria-hidden /> Deposit / withdrawal
          </Button>
        }
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More actions">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={none} onSelect={() => setValuing(true)}>
            Update value
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAdding("ibkr")}>Add investment account</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAdding("deposits")}>Add bank deposit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ValuationDialog options={options} current={current} open={valuing} onOpenChange={setValuing} />
      <AccountDialog
        key={adding ?? "closed"}
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        defaults={adding === "deposits" ? { group: "deposits", currency: "UAH" } : { group: "ibkr", currency: "USD" }}
      />
    </>
  );
}
