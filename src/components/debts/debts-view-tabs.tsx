"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type * as React from "react";
import { useOptimistic, useTransition } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DebtsView } from "@/server/queries";

const VIEWS: readonly { value: DebtsView; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "settled", label: "Settled" },
  { value: "all", label: "All" },
];

/** Open / Settled / All tabs bound to `?view=` (switches optimistically; the panel dims until the server answers). */
export function DebtsViewTabs({
  view,
  counts,
  children,
}: {
  view: DebtsView;
  counts: { open: number; settled: number };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(view);
  const count: Record<DebtsView, number> = { open: counts.open, settled: counts.settled, all: counts.open + counts.settled };

  function onValueChange(value: string) {
    const next = (VIEWS.find((v) => v.value === value)?.value ?? "open") as DebtsView;
    if (next === current) return;
    startTransition(() => {
      setCurrent(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === "open") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <Tabs value={current} onValueChange={onValueChange} activationMode="manual" className="min-w-0 gap-3">
      <div className="flex items-center gap-2">
        <TabsList aria-label="Which debts">
          {VIEWS.map((v) => (
            <TabsTrigger key={v.value} value={v.value} className="px-2.5">
              {v.label}
              <span className="text-xs text-muted-foreground tabular-nums">{count[v.value]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {pending ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
      </div>
      <TabsContent value={current} aria-busy={pending || undefined} className={cn("min-w-0 transition-opacity", pending && "opacity-60")}>
        {children}
      </TabsContent>
    </Tabs>
  );
}
