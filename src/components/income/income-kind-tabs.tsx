"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type * as React from "react";
import { useOptimistic, useTransition } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { IncomeKindFilter } from "@/server/queries";
import { INCOME_KIND_FILTERS, INCOME_KIND_FILTER_LABELS, incomeHref, parseIncomeKindFilter } from "./income-view";

export interface IncomeKindTabsProps {
  /** Current tab from the loader (`data.filters.kind`). */
  kind: IncomeKindFilter;
  /** Incomes per tab in the period (shown after the label). */
  counts?: Partial<Record<IncomeKindFilter, number>>;
  /** The panel (server-rendered table / empty state). */
  children: React.ReactNode;
  className?: string;
}

/**
 * All / Salary / Freelance tabs bound to `?kind=` (every other search param is preserved). The tab
 * switches optimistically; the panel keeps the previous content dimmed until the server re-render
 * arrives. Manual activation: arrow keys move focus, Enter / Space switches (one request per switch).
 */
export function IncomeKindTabs({ kind, counts, children, className }: IncomeKindTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(kind);

  function onValueChange(value: string) {
    const next = parseIncomeKindFilter(value);
    if (next === current) return;
    startTransition(() => {
      setCurrent(next);
      router.replace(incomeHref(searchParams.toString(), { kind: next }, pathname), { scroll: false });
    });
  }

  return (
    <Tabs value={current} onValueChange={onValueChange} activationMode="manual" className={cn("min-w-0 gap-3", className)}>
      <div className="flex items-center gap-2">
        <TabsList variant="line" aria-label="Income type" className="-ml-1.5">
          {INCOME_KIND_FILTERS.map((k) => (
            <TabsTrigger key={k} value={k} className="px-1.5">
              {INCOME_KIND_FILTER_LABELS[k]}
              {counts?.[k] !== undefined ? <span className="text-xs text-muted-foreground tabular-nums">{counts[k]}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {pending ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
      </div>
      <TabsContent
        value={current}
        aria-busy={pending || undefined}
        className={cn("min-w-0 transition-opacity", pending && "opacity-60")}
      >
        {children}
      </TabsContent>
    </Tabs>
  );
}
