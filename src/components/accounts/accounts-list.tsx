"use client";

import { useState } from "react";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { AccountRowActions } from "./account-row-actions";
import { groupCheckState, summarizeSelection, type AccountRowView, type GroupSectionView, type SelectionSummary } from "./accounts-view";

/** Amount columns line up across rows, group totals and the bottom row: account currency, then UAH. */
const AMOUNT_COLUMN = "text-right sm:w-32";
const AMOUNTS = "flex shrink-0 flex-col-reverse items-end sm:flex-row sm:items-baseline sm:gap-3";
const ROW = "-mx-2 flex items-center gap-2.5 px-2";
/** Keeps totals clear of the rows' "…" button. */
const ACTIONS_SPACER = <span aria-hidden className="w-7 shrink-0" />;

export interface AccountsListProps {
  sections: GroupSectionView[];
  netWorthUah: number;
  /** Some account has no NBU rate, so `netWorthUah` leaves it out. */
  incomplete: boolean;
}

/**
 * Every account on one compact list, by group. Ticking accounts (or a whole group) turns the bottom row
 * from Net worth into the sum of the selection. The selection is a view only and stays on this page.
 */
export function AccountsList({ sections, netWorthUah, incomplete }: AccountsListProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const rows = sections.flatMap((s) => s.rows);
  const summary = summarizeSelection(rows, selected);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function toggleGroup(section: GroupSectionView) {
    const ids = section.rows.map((r) => r.account.id);
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  return (
    <div data-testid="accounts-list" className="flex flex-col">
      {sections.map((section) => (
        <section key={section.group} id={`group-${section.group}`} aria-label={section.label} className="border-t py-1.5 first:border-t-0 first:pt-0">
          <GroupHeader section={section} checked={groupCheckState(section.rows, selected)} onToggle={() => toggleGroup(section)} />
          <ul role="list" aria-label={`${section.label} accounts`}>
            {section.rows.map((row) => (
              <AccountRow key={row.account.id} row={row} selected={selected.has(row.account.id)} onToggle={() => toggle(row.account.id)} />
            ))}
          </ul>
        </section>
      ))}
      <TotalRow summary={summary} netWorthUah={netWorthUah} incomplete={incomplete} onClear={() => setSelected(new Set())} />
    </div>
  );
}

function GroupHeader({ section, checked, onToggle }: { section: GroupSectionView; checked: boolean | "indeterminate"; onToggle: () => void }) {
  const id = `select-group-${section.group}`;
  return (
    <div className={cn(ROW, "min-h-8")}>
      {section.rows.length > 0 ? (
        <Checkbox id={id} checked={checked} onCheckedChange={onToggle} aria-label={`Select all ${section.label} accounts`} />
      ) : (
        <span aria-hidden className="size-4 shrink-0" />
      )}
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
        {section.rows.length > 0 ? (
          <label htmlFor={id} className="cursor-pointer">
            {section.label}
          </label>
        ) : (
          section.label
        )}
      </h2>
      {section.incomplete ? <span className="text-xs text-warning">partial</span> : null}
      <span className={cn("text-sm font-medium", AMOUNT_COLUMN)}>
        <span className="sr-only">{section.label} total in UAH:</span>
        <Money amount={section.totalUah} currency="UAH" />
      </span>
      {ACTIONS_SPACER}
    </div>
  );
}

function AccountRow({ row, selected, onToggle }: { row: AccountRowView; selected: boolean; onToggle: () => void }) {
  const { account, usage, balance, isDefault } = row;
  const id = `select-account-${account.id}`;
  return (
    <li
      data-testid="account-row"
      data-account={account.name}
      data-selected={selected}
      className={cn(ROW, "min-h-8 rounded-md py-0.5 data-selected:bg-muted")}
    >
      <Checkbox id={id} checked={selected} onCheckedChange={onToggle} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <label htmlFor={id} className={cn("cursor-pointer truncate text-sm", account.archived && "text-muted-foreground")} title={account.note ?? account.name}>
          {account.name}
        </label>
        {isDefault ? (
          <span className="shrink-0 text-xs text-muted-foreground" title="Default account for salary and spendings">
            Main
          </span>
        ) : null}
        {account.archived ? <span className="shrink-0 text-xs text-muted-foreground">archived</span> : null}
      </div>
      <div className={AMOUNTS}>
        {account.currency === "UAH" ? (
          <Money amount={balance} currency="UAH" className={cn("text-sm", AMOUNT_COLUMN, balance < 0 && "text-negative")} data-testid="account-balance" />
        ) : (
          <>
            <Money
              amount={balance}
              currency={account.currency}
              className={cn("text-xs text-muted-foreground sm:text-sm", AMOUNT_COLUMN, balance < 0 && "text-negative")}
              data-testid="account-balance"
            />
            <UahEquivalent row={row} />
          </>
        )}
      </div>
      <AccountRowActions account={account} usage={usage} balance={balance} isDefault={isDefault} />
    </li>
  );
}

/** "≈ 24 750,00 ₴" (the NBU rate and its date in the tooltip). */
function UahEquivalent({ row }: { row: AccountRowView }) {
  if (row.balanceUah === null || row.rate === null) {
    return (
      <span className={cn("text-xs text-warning", AMOUNT_COLUMN)} role="status">
        No NBU rate
      </span>
    );
  }
  const rateTitle = `NBU rate${row.stale ? " (latest available)" : ""}${row.rateDate ? ` of ${formatDate(row.rateDate)}` : ""}`;
  return (
    <span className={cn("text-sm", AMOUNT_COLUMN)} title={rateTitle}>
      <span aria-hidden className="text-muted-foreground">
        ≈{" "}
      </span>
      <span className="sr-only">about </span>
      <Money amount={row.balanceUah} currency="UAH" />
    </span>
  );
}

/** Net worth, or the sum of the selected accounts. Stays on screen while the list scrolls. */
function TotalRow({ summary, netWorthUah, incomplete, onClear }: { summary: SelectionSummary; netWorthUah: number; incomplete: boolean; onClear: () => void }) {
  const selecting = summary.count > 0;
  const partial = selecting ? summary.missingRates > 0 : incomplete;
  return (
    <div className="sticky bottom-0 flex min-h-10 items-center gap-2.5 border-t bg-background py-1">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span aria-live="polite" className="truncate text-sm font-medium" data-testid={selecting ? "accounts-selection-count" : undefined}>
          {selecting ? `${summary.count} selected` : "Net worth"}
        </span>
        {partial ? (
          <span className="text-xs text-warning" title="Accounts without an NBU rate are left out">
            partial
          </span>
        ) : null}
        {selecting ? (
          <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>
      <div className={AMOUNTS}>
        {summary.foreign.length > 0 ? (
          <span className="text-xs text-muted-foreground" data-testid="accounts-selection-foreign">
            {summary.foreign.map((f, i) => (
              <span key={f.currency}>
                {i > 0 ? " + " : null}
                <Money amount={f.amount} currency={f.currency} />
              </span>
            ))}
          </span>
        ) : null}
        <Money amount={selecting ? summary.totalUah : netWorthUah} currency="UAH" className={cn("text-sm font-semibold", AMOUNT_COLUMN)} data-testid="accounts-total" />
      </div>
      {ACTIONS_SPACER}
    </div>
  );
}
