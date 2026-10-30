"use client";

import { ChevronDown, Tags } from "lucide-react";
import { useOptimistic, useState } from "react";
import { CategoryBadge } from "@/components/shared/category-badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { categoryColorVar, splitPinned } from "@/lib/categories";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { serializeCategoryIds } from "./expense-list-model";
import { useExpensesNav } from "./expenses-nav";

export interface CategoryFilterProps {
  /** All categories (incl. archived), pinned first, then by name. */
  categories: readonly Category[];
  /** Selected ids from the URL (`?category=a,b`). */
  value: readonly string[];
}

/** Multi-select category filter (popover + searchable list). Each toggle updates the URL at once. */
export function CategoryFilter({ categories, value }: CategoryFilterProps) {
  const { navigate } = useExpensesNav();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useOptimistic<readonly string[]>(value);
  const selectedSet = new Set(selected);
  const byId = new Map(categories.map((c) => [c.id, c]));

  function commit(next: readonly string[]) {
    navigate({ category: serializeCategoryIds(next) }, { optimistic: () => setSelected(next) });
  }

  function toggle(id: string) {
    commit(selectedSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const { pinned, others: active } = splitPinned(categories.filter((c) => !c.archived));
  const archived = categories.filter((c) => c.archived);
  const single = selected.length === 1 ? byId.get(selected[0]) : undefined;

  const item = (c: Category) => {
    const checked = selectedSet.has(c.id);
    return (
      <CommandItem
        key={c.id}
        value={`${c.name} ${c.id}`}
        keywords={[c.name]}
        onSelect={() => toggle(c.id)}
        data-checked={checked}
        aria-checked={checked}
      >
        <CategoryBadge category={c} variant="inline" className="min-w-0" />
      </CommandItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("max-w-full min-w-0 justify-start font-normal", selected.length > 0 && "border-primary/50")}
          aria-label={
            selected.length === 0
              ? "Filter by category: all categories"
              : `Filter by category: ${selected.map((id) => byId.get(id)?.name ?? "Unknown").join(", ")}`
          }
        >
          {single ? (
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColorVar(single.color) }} />
          ) : (
            <Tags aria-hidden className="text-muted-foreground" />
          )}
          <span className="truncate">
            {selected.length === 0 ? "All categories" : single ? single.name : `${selected.length} categories`}
          </span>
          <ChevronDown aria-hidden className="ml-auto text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command
          label="Filter by category"
          // cmdk matches against value + keywords; ids are appended only to keep values unique.
          filter={(itemValue, search, keywords) =>
            (keywords ?? [itemValue]).some((k) => k.toLocaleLowerCase("uk-UA").includes(search.trim().toLocaleLowerCase("uk-UA")))
              ? 1
              : 0
          }
        >
          <CommandInput placeholder="Find a category…" />
          <CommandList label="Categories">
            <CommandEmpty>No category found.</CommandEmpty>
            {pinned.length ? (
              <>
                <CommandGroup heading="Pinned">{pinned.map(item)}</CommandGroup>
                {active.length ? <CommandSeparator /> : null}
              </>
            ) : null}
            <CommandGroup>{active.map(item)}</CommandGroup>
            {archived.length ? (
              <>
                <CommandSeparator />
                <CommandGroup heading="Archived">{archived.map(item)}</CommandGroup>
              </>
            ) : null}
          </CommandList>
          {selected.length ? (
            <div className="border-t p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => commit([])}>
                Clear selection
              </Button>
            </div>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
