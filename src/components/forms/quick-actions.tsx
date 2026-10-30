"use client";

import { ArrowLeftRight, BriefcaseBusiness, HandCoins, Plus, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FormOptions } from "@/server/queries";
import { cn } from "@/lib/utils";
import { AdjustBalanceDialog } from "./adjust-balance-dialog";
import { ExpenseDialog } from "./expense-dialog";
import { IncomeDialog } from "./income-dialog";
import { TransferDialog } from "./transfer-dialog";

export interface QuickActionsProps {
  /** From `getFormOptions()`. */
  options: FormOptions;
  className?: string;
}

/** The five everyday actions (Overview): Add spending, Add salary, Add freelance income, Transfer, Update balance. */
export function QuickActions({ options, className }: QuickActionsProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} data-slot="quick-actions">
      <ExpenseDialog
        options={options}
        trigger={
          <Button>
            <Plus /> Add spending
          </Button>
        }
      />
      <IncomeDialog
        mode="salary"
        options={options}
        trigger={
          <Button variant="outline">
            <HandCoins /> Add salary
          </Button>
        }
      />
      <IncomeDialog
        mode="freelance"
        options={options}
        trigger={
          <Button variant="outline">
            <BriefcaseBusiness /> Add freelance income
          </Button>
        }
      />
      <TransferDialog
        options={options}
        trigger={
          <Button variant="outline">
            <ArrowLeftRight /> Transfer
          </Button>
        }
      />
      <AdjustBalanceDialog
        options={options}
        accountId={options.defaultActiveAccountId}
        trigger={
          <Button variant="outline">
            <Scale /> Update balance
          </Button>
        }
      />
    </div>
  );
}
