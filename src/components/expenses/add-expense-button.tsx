"use client";

import { Plus } from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { ExpenseDialog, type ExpenseDialogOptions, type ExpenseDialogProps } from "@/components/forms/expense-dialog";
import { Button } from "@/components/ui/button";
import type { Expense } from "@/lib/types";
import { hiddenReason, type ExpenseViewContext } from "./expense-list-model";

/** After a save, tell the user when the spending is not visible under the current filters. */
export function notifyIfHidden(expense: Expense, view: ExpenseViewContext) {
  const reason = hiddenReason(expense, view);
  if (reason) toast.info("Not shown with the current filters", { description: reason });
}

export interface AddExpenseButtonProps {
  options: ExpenseDialogOptions;
  view: ExpenseViewContext;
  defaults?: ExpenseDialogProps["defaults"];
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}

/** "Add spending" button + ExpenseDialog, prefilled from the active filters. */
export function AddExpenseButton({ options, view, defaults, label = "Add spending", variant, size, className }: AddExpenseButtonProps) {
  return (
    <ExpenseDialog
      options={options}
      defaults={defaults}
      onSaved={(expense) => notifyIfHidden(expense, view)}
      trigger={
        <Button type="button" variant={variant} size={size} className={className}>
          <Plus aria-hidden /> {label}
        </Button>
      }
    />
  );
}
