"use client";

import type * as React from "react";
import { toast } from "sonner";
import { IncomeDialog, type IncomeDialogOptions } from "@/components/forms/income-dialog";
import { Button } from "@/components/ui/button";
import type { DateRange } from "@/lib/periods";
import type { IncomeKind } from "@/lib/types";
import type { IncomeKindFilter } from "@/server/queries";
import { incomeHiddenReason } from "./income-view";

export interface AddIncomeButtonProps {
  mode: IncomeKind;
  options: IncomeDialogOptions;
  /** What the list currently shows — to explain why a just-saved income is not in it. */
  view: { range: DateRange; kind: IncomeKindFilter };
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  children: React.ReactNode;
}

/** "Add salary" / "Add freelance income" on the Income page: tells the user when the new record is filtered out. */
export function AddIncomeButton({ mode, options, view, variant, size, children }: AddIncomeButtonProps) {
  return (
    <IncomeDialog
      mode={mode}
      options={options}
      onSaved={(income) => {
        const reason = incomeHiddenReason(income, view);
        if (reason) toast.info("Not shown with the current filters", { description: reason });
      }}
      trigger={
        <Button variant={variant} size={size}>
          {children}
        </Button>
      }
    />
  );
}
