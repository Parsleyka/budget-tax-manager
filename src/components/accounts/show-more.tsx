"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export const PAGE_SIZE = 5;

export interface Paged<T> {
  visible: T[];
  total: number;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
}

/** Shows the first `PAGE_SIZE` items until expanded (long histories stay short). */
export function usePaged<T>(items: readonly T[], pageSize = PAGE_SIZE): Paged<T> {
  const [expanded, setExpanded] = useState(false);
  return {
    visible: expanded ? [...items] : items.slice(0, pageSize),
    total: items.length,
    expanded,
    setExpanded,
  };
}

/** "Show all (12)" / "Show fewer" — nothing when everything fits. */
export function ShowAllButton<T>({ paged, pageSize = PAGE_SIZE }: { paged: Paged<T>; pageSize?: number }) {
  if (paged.total <= pageSize) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="-ml-2 self-start text-muted-foreground"
      onClick={() => paged.setExpanded(!paged.expanded)}
      aria-expanded={paged.expanded}
    >
      {paged.expanded ? "Show fewer" : `Show all (${paged.total})`}
    </Button>
  );
}
