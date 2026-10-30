"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { IncomeDialog, type IncomeDialogOptions } from "@/components/forms/income-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DateRange } from "@/lib/periods";
import type { Income } from "@/lib/types";
import type { IncomeKindFilter } from "@/server/queries";
import { incomeHiddenReason } from "./income-view";

/** Income page actions: "Add salary" (primary) + a "…" menu with "Add freelance income". */
export function IncomeHeaderActions({
  options,
  view,
}: {
  options: IncomeDialogOptions;
  /** What the list currently shows — to explain why a just-saved income is not in it. */
  view: { range: DateRange; kind: IncomeKindFilter };
}) {
  // The freelance dialog opens from a menu item, so it is controlled (the menu closes first).
  const [freelanceOpen, setFreelanceOpen] = useState(false);
  const onSaved = (income: Income) => {
    const reason = incomeHiddenReason(income, view);
    if (reason) toast.info("Not shown with the current filters", { description: reason });
  };
  return (
    <>
      <IncomeDialog
        mode="salary"
        options={options}
        onSaved={onSaved}
        trigger={
          <Button>
            <Plus aria-hidden /> Add salary
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
          <DropdownMenuItem onSelect={() => setFreelanceOpen(true)}>Add freelance income</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IncomeDialog mode="freelance" options={options} open={freelanceOpen} onOpenChange={setFreelanceOpen} onSaved={onSaved} />
    </>
  );
}
