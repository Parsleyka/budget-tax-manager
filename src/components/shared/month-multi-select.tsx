"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { monthName, monthOf, quarterMonths, QUARTERS, type ISODate, type ISOMonth, type Quarter } from "@/lib/dates";
import { wholeYear, yearToDateMonths } from "@/lib/tax/engine";
import { cn } from "@/lib/utils";

export interface MonthMultiSelectProps {
  /** Year whose months are shown. */
  year: number;
  /** Years offered in the select (e.g. `data.years`). The current `year` is always included. */
  years: readonly number[];
  onYearChange: (year: number) => void;
  /** Selected months ("YYYY-MM"). Months of other years are ignored for display. */
  value: readonly ISOMonth[];
  onChange: (months: ISOMonth[]) => void;
  /** Today (Kyiv) from the loader — drives YTD and marks future months. */
  today: ISODate;
  disabled?: boolean;
  className?: string;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Controlled month picker for one year: year select + 12 month chips + presets (Q1–Q4, Year, YTD, Clear).
 * Output is always sorted. Future months stay selectable (dimmed).
 */
export function MonthMultiSelect({ year, years, onYearChange, value, onChange, today, disabled, className }: MonthMultiSelectProps) {
  const months = wholeYear(year);
  const selected = value.filter((m) => m.startsWith(`${year}-`));
  const selectedSet = new Set(selected);
  const currentMonth = monthOf(today);
  const yearOptions = [...new Set([...years, year])].sort((a, b) => b - a);

  const emit = (next: Iterable<ISOMonth>) => onChange([...new Set(next)].sort());

  function toggle(m: ISOMonth) {
    const next = new Set(selectedSet);
    if (next.has(m)) next.delete(m);
    else next.add(m);
    emit(next);
  }

  const presets: { label: string; months: ISOMonth[]; title: string }[] = [
    ...QUARTERS.map((q: Quarter) => ({ label: `Q${q}`, months: quarterMonths(year, q), title: `Quarter ${q} ${year}` })),
    { label: "Year", months: wholeYear(year), title: `All of ${year}` },
    { label: "YTD", months: yearToDateMonths(year, today), title: "January through the current month" },
  ];

  return (
    <div data-slot="month-multi-select" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(year)} onValueChange={(v) => onYearChange(Number(v))} disabled={disabled}>
          <SelectTrigger size="sm" className="w-24" aria-label="Year">
            {/* Explicit label: Radix renders an empty SelectValue on the server until hydration. */}
            <SelectValue>{year}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Month presets">
          {presets.map((p) => {
            const active = p.months.length > 0 && sameSet(p.months, selected);
            return (
              <Button
                key={p.label}
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                aria-pressed={active}
                title={p.title}
                disabled={disabled || p.months.length === 0}
                onClick={() => emit(p.months)}
                className={cn("px-2", active && "ring-1 ring-primary/40")}
              >
                {p.label}
              </Button>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="px-2 text-muted-foreground"
            disabled={disabled || selected.length === 0}
            onClick={() => onChange(value.filter((m) => !m.startsWith(`${year}-`)))}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12" role="group" aria-label={`Months of ${year}`}>
        {months.map((m, i) => {
          const on = selectedSet.has(m);
          const future = m > currentMonth;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              title={`${monthName(i + 1, true)} ${year}${future ? " (future)" : ""}`}
              onClick={() => toggle(m)}
              className={cn(
                "h-8 rounded-md border text-xs font-medium transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                on
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border-border bg-background hover:bg-muted",
                !on && future && "text-muted-foreground border-dashed",
              )}
            >
              {monthName(i + 1)}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {selected.length === 0
          ? "No months selected"
          : selected.length === 12
            ? `All of ${year}`
            : `${selected.length} month${selected.length === 1 ? "" : "s"} selected`}
      </p>
    </div>
  );
}
