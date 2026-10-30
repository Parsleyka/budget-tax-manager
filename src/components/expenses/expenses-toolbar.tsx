"use client";

import { Search, X } from "lucide-react";
import { useEffect, useOptimistic, useRef, useState } from "react";
import { AccountLabel } from "@/components/shared/account-label";
import { PeriodPicker } from "@/components/shared/period-picker";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { ISODate } from "@/lib/dates";
import type { DateRange, PeriodPreset } from "@/lib/periods";
import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type Account, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CategoryFilter } from "./category-filter";
import { useExpensesNav } from "./expenses-nav";

const SEARCH_DEBOUNCE_MS = 350;
const ALL = "all";

export interface ExpensesToolbarProps {
  preset: PeriodPreset;
  range: DateRange;
  today: ISODate;
  /** All categories / accounts (incl. archived) — archived ones can still be filtered on. */
  categories: readonly Category[];
  accounts: readonly Account[];
  categoryIds: readonly string[];
  accountId: string | null;
  q: string;
}

/**
 * Filter row for the Spendings page (rendered as PageHeader children): period, categories (multi),
 * account, note search and "Clear". Everything is URL state; the server loader applies it.
 */
export function ExpensesToolbar({ preset, range, today, categories, accounts, categoryIds, accountId, q }: ExpensesToolbarProps) {
  const { navigate, pending } = useExpensesNav();
  const search = useSearchBox(q, (next) => navigate({ q: next || null }));
  const hasFilters = categoryIds.length > 0 || !!accountId || !!q;

  return (
    <>
      <PeriodPicker preset={preset} range={range} today={today} resetParams={["limit"]} />
      <CategoryFilter categories={categories} value={categoryIds} />
      <AccountFilter accounts={accounts} value={accountId} />
      <form
        role="search"
        className="w-full sm:w-56"
        onSubmit={(e) => {
          e.preventDefault();
          search.flush();
        }}
      >
        <InputGroup className="h-7">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search.value}
            onChange={(e) => search.change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search.value) {
                e.preventDefault();
                search.clear();
              }
            }}
            placeholder="Search notes…"
            aria-label="Search spendings by note"
            enterKeyHint="search"
            className="h-7 text-sm [&::-webkit-search-cancel-button]:hidden"
            maxLength={200}
          />
          {search.value ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => search.clear()}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </form>
      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            search.reset();
            navigate({ category: null, account: null, q: null });
          }}
        >
          <X aria-hidden /> Clear filters
        </Button>
      ) : null}
      <span role="status" aria-live="polite" className={cn("flex items-center", !pending && "sr-only")}>
        {pending ? (
          <>
            <Spinner className="size-3.5 text-muted-foreground" />
            <span className="sr-only">Updating spendings…</span>
          </>
        ) : null}
      </span>
    </>
  );
}

// ------------------------------------------------------------------ account filter

function AccountFilter({ accounts, value }: { accounts: readonly Account[]; value: string | null }) {
  const { navigate } = useExpensesNav();
  const [selected, setSelected] = useOptimistic(value);
  const groups = ACCOUNT_GROUPS.map((g) => ({ g, items: accounts.filter((a) => a.group === g) })).filter((x) => x.items.length);
  const current = selected ? accounts.find((a) => a.id === selected) : undefined;
  const unknown = selected && !current;

  return (
    <Select
      value={selected ?? ALL}
      onValueChange={(v) => {
        const next = v === ALL ? null : v;
        navigate({ account: next }, { optimistic: () => setSelected(next) });
      }}
    >
      <SelectTrigger size="sm" className={cn("max-w-full min-w-36 sm:max-w-60", selected && "border-primary/50")} aria-label="Filter by account">
        {/* Explicit children so the label is in the server HTML too (Radix fills it only after hydration). */}
        <SelectValue>{current ? <AccountLabel account={current} showIcon={false} /> : selected ? "Unknown account" : "All accounts"}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        <SelectItem value={ALL}>All accounts</SelectItem>
        {unknown ? <SelectItem value={selected}>Unknown account</SelectItem> : null}
        <SelectSeparator />
        {groups.map(({ g, items }) => (
          <SelectGroup key={g}>
            <SelectLabel>{ACCOUNT_GROUP_LABELS[g]}</SelectLabel>
            {items.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <AccountLabel account={a} showIcon={false} />
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

// ------------------------------------------------------------------ debounced search

/**
 * Local input state for `?q=`, committed after a short pause (or on Enter). The URL value wins when
 * it changes from outside (back button, "Clear filters"), but not when it is just our own commit
 * arriving back — so typing ahead of the server is never overwritten.
 */
function useSearchBox(q: string, commit: (value: string) => void) {
  const [value, setValue] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  const [sentQ, setSentQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (q !== seenQ) {
    setSeenQ(q);
    if (q !== sentQ) {
      setValue(q);
      setSentQ(q);
    }
  }

  useEffect(() => {
    const t = timer;
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, []);

  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function send(raw: string) {
    cancel();
    const next = raw.trim();
    if (next === sentQ) return;
    setSentQ(next);
    commit(next);
  }

  return {
    value,
    change(next: string) {
      setValue(next);
      cancel();
      timer.current = setTimeout(() => send(next), SEARCH_DEBOUNCE_MS);
    },
    flush() {
      send(value);
    },
    clear() {
      setValue("");
      send("");
    },
    /** Reset locally without committing (the caller navigates itself). */
    reset() {
      cancel();
      setValue("");
      setSentQ("");
    },
  };
}
