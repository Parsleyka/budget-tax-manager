"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useState } from "react";
import { DebtDialog, type DebtDialogOptions } from "@/components/forms/debt-dialog";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DebtDirection } from "@/lib/types";
import type { DebtRow, DebtsView } from "@/server/queries";
import { DebtItem } from "./debt-item";

const COPY: Record<DebtDirection, { title: string; add: string; empty: Record<DebtsView, string> }> = {
  lent: {
    title: "Owed to you",
    add: "I lent money",
    empty: { open: "Nobody owes you money.", settled: "No settled loans.", all: "No loans yet." },
  },
  borrowed: {
    title: "You owe",
    add: "I borrowed money",
    empty: { open: "You don't owe anyone.", settled: "No settled debts.", all: "No debts yet." },
  },
};

export interface DebtsSectionProps {
  direction: DebtDirection;
  rows: DebtRow[];
  view: DebtsView;
  options: DebtDialogOptions;
  people: readonly string[];
}

/** One side (lent / borrowed) of the Debts page: overdue and soonest due first. */
export function DebtsSection({ direction, rows, view, options, people }: DebtsSectionProps) {
  const copy = COPY[direction];
  return (
    <SectionCard id={direction} title={copy.title} description={rows.length ? rows.length : undefined}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.empty[view]}</p>
      ) : (
        <ul className="flex flex-col divide-y" aria-label={copy.title} data-testid={`debts-${direction}`}>
          {rows.map((row) => (
            <DebtItem key={row.debt.id} row={row} options={options} people={people} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** Page-header actions: "I lent money" (primary); "I borrowed money" in the "…" menu. */
export function DebtsHeaderActions({ options, people }: { options: DebtDialogOptions; people: readonly string[] }) {
  // Opened from a menu item, so controlled (the menu closes first).
  const [borrowing, setBorrowing] = useState(false);
  return (
    <>
      <DebtDialog
        options={options}
        direction="lent"
        people={people}
        trigger={
          <Button>
            <Plus aria-hidden /> {COPY.lent.add}
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
          <DropdownMenuItem onSelect={() => setBorrowing(true)}>{COPY.borrowed.add}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DebtDialog options={options} direction="borrowed" people={people} open={borrowing} onOpenChange={setBorrowing} />
    </>
  );
}
