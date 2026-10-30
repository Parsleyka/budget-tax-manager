"use client";

import { useOptimistic, useState } from "react";
import { CategoryBadge } from "@/components/shared/category-badge";
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { CategorySpending } from "@/lib/analytics";
import { categoryColorVar } from "@/lib/categories";
import { formatPercent } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BREAKDOWN_LIMIT, breakdownRows, serializeCategoryIds, soleCategoryToggle } from "./expense-list-model";
import { useExpensesNav } from "./expenses-nav";

export interface CategoryBreakdownProps {
  /** The period's spending per category, biggest first. */
  rows: readonly CategorySpending[];
  /** Ids of existing categories — rows of deleted ones are shown but cannot filter. */
  knownIds: readonly string[];
  /** Selected ids from the URL (`?category=`). */
  value: readonly string[];
}

/**
 * "By category": the period's spending as one bar list (biggest first, top 6 + "Show all").
 * A row filters the list below to that category; selecting it again clears the filter.
 */
export function CategoryBreakdown({ rows, knownIds, value }: CategoryBreakdownProps) {
  const { navigate } = useExpensesNav();
  const [selected, setSelected] = useOptimistic<readonly string[]>(value);
  const items = breakdownRows(rows);
  // A selected category below the fold opens the full list, so the highlight is never hidden.
  const [expanded, setExpanded] = useState(() => items.findIndex((r) => value.includes(r.categoryId)) >= BREAKDOWN_LIMIT);
  const known = new Set(knownIds);
  const shown = expanded ? items : items.slice(0, BREAKDOWN_LIMIT);

  function pick(id: string) {
    const next = soleCategoryToggle(selected, id);
    navigate({ category: serializeCategoryIds(next) }, { optimistic: () => setSelected(next) });
  }

  return (
    <SectionCard title="By category" contentClassName="flex flex-col">
      <ul className="flex flex-col" aria-label="Spending by category" data-testid="category-breakdown">
        {shown.map((r) => {
          const isSelected = selected.includes(r.categoryId);
          const body = (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <CategoryBadge category={r} className="min-w-0" />
                <span className="flex shrink-0 items-baseline gap-3">
                  <Money amount={r.totalUah} currency="UAH" className="text-sm" />
                  <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{formatPercent(r.share)}</span>
                </span>
              </span>
              <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(r.width * 100, 1)}%`, backgroundColor: categoryColorVar(r.color) }}
                />
              </span>
            </>
          );
          return (
            <li key={r.categoryId}>
              {known.has(r.categoryId) ? (
                <button
                  type="button"
                  onClick={() => pick(r.categoryId)}
                  aria-pressed={isSelected}
                  title={isSelected ? "Show all categories" : `Show only ${r.name}`}
                  className={cn(
                    "-mx-2 flex w-[calc(100%+1rem)] flex-col gap-1.5 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
                    isSelected && "bg-muted",
                    selected.length > 0 && !isSelected && "opacity-60",
                  )}
                >
                  {body}
                </button>
              ) : (
                <div className="flex flex-col gap-1.5 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {items.length > BREAKDOWN_LIMIT ? (
        <Button type="button" variant="ghost" size="sm" className="-ml-2 self-start text-muted-foreground" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `Show all ${items.length}`}
        </Button>
      ) : null}
    </SectionCard>
  );
}
