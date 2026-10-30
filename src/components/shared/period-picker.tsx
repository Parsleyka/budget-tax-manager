"use client";

import { CalendarRange } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  addMonths,
  compareDates,
  dateFromLocalDate,
  formatDateRange,
  localDateFromDate,
  monthOf,
  monthStart,
  yearOf,
  type ISODate,
} from "@/lib/dates";
import { PERIOD_PRESETS, PERIOD_PRESET_LABELS, type DateRange, type PeriodPreset } from "@/lib/periods";
import { cn } from "@/lib/utils";

export interface PeriodPickerProps {
  /** Current preset from the loader (`data.filters.preset` / `data.preset`). */
  preset: PeriodPreset;
  /** Current resolved range from the loader (`data.range`). */
  range: DateRange;
  /** Today (Kyiv) from the loader. */
  today: ISODate;
  /** Presets offered in the select (default: all, incl. "custom"). */
  presets?: readonly PeriodPreset[];
  /** Hide the range button (show only the preset select). Default false. */
  hideRange?: boolean;
  /** Search params removed whenever the period changes (e.g. `["limit"]` to reset "Show more"). */
  resetParams?: readonly string[];
  className?: string;
}

/**
 * Period filter bound to the URL: writes `?period=<preset>` (or `?period=custom&from=…&to=…`) with
 * `router.replace`, preserving every other search param. The page loader re-runs on the server
 * (`parsePeriodParams`), so the component itself holds no data — it just reflects `preset`/`range`.
 */
export function PeriodPicker({
  preset,
  range,
  today,
  presets = PERIOD_PRESETS,
  hideRange = false,
  resetParams,
  className,
}: PeriodPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayPickerRange | undefined>(undefined);

  function navigate(next: { period: PeriodPreset; from?: ISODate; to?: ISODate }) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of resetParams ?? []) params.delete(key);
    params.set("period", next.period);
    if (next.from && next.to) {
      params.set("from", next.from);
      params.set("to", next.to);
    } else {
      params.delete("from");
      params.delete("to");
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function onPreset(value: string) {
    const p = value as PeriodPreset;
    if (p === "custom") {
      setDraft({ from: localDateFromDate(range.from), to: localDateFromDate(range.to) });
      // Open after the Select has closed and restored focus to its trigger — otherwise that focus
      // move counts as "outside" and dismisses the popover immediately.
      setTimeout(() => setOpen(true), 50);
      return;
    }
    navigate({ period: p });
  }

  function onOpenChange(next: boolean) {
    if (next) setDraft({ from: localDateFromDate(range.from), to: localDateFromDate(range.to) });
    setOpen(next);
  }

  function apply() {
    if (!draft?.from) return;
    let from = dateFromLocalDate(draft.from);
    let to = dateFromLocalDate(draft.to ?? draft.from);
    if (compareDates(from, to) > 0) [from, to] = [to, from];
    setOpen(false);
    navigate({ period: "custom", from, to });
  }

  const options = presets.includes(preset) ? presets : [...presets, preset];
  const todayYear = yearOf(today);
  const firstYear = Math.min(2015, todayYear - 5);
  // Open on the range's END (and the month before it on desktop), so "This month" shows Sep–Oct and
  // "All time" does not start years back; the month/year dropdowns jump anywhere else.
  const openMonth = isMobile ? monthOf(range.to) : addMonths(monthOf(range.to), -1);
  const defaultMonth = monthStart(yearOf(openMonth) < firstYear ? `${firstYear}-01` : openMonth);

  return (
    <div data-slot="period-picker" className={cn("flex flex-wrap items-center gap-2", className)}>
      <Select value={preset} onValueChange={onPreset}>
        <SelectTrigger size="sm" className="min-w-36" aria-label="Period">
          {/* Explicit label: Radix renders an empty SelectValue on the server until hydration. */}
          <SelectValue>{PERIOD_PRESET_LABELS[preset]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((p) => (
            <SelectItem key={p} value={p}>
              {PERIOD_PRESET_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hideRange ? null : (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 font-normal tabular-nums" title="Choose a custom date range">
              {pending ? <Spinner className="size-3.5" /> : <CalendarRange aria-hidden className="text-muted-foreground" />}
              {/* Visible range = accessible name (WCAG 2.5.3); the prefix is for screen readers only. */}
              <span className="sr-only">Date range: </span>
              {formatDateRange(range.from, range.to)}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              resetOnSelect
              weekStartsOn={1}
              numberOfMonths={isMobile ? 1 : 2}
              captionLayout="dropdown"
              today={localDateFromDate(today)}
              defaultMonth={localDateFromDate(defaultMonth)}
              startMonth={new Date(firstYear, 0)}
              endMonth={new Date(todayYear + 1, 11)}
              selected={draft}
              onSelect={setDraft}
            />
            <div className="flex items-center justify-between gap-2 border-t p-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {draft?.from
                  ? formatDateRange(
                      dateFromLocalDate(draft.from),
                      dateFromLocalDate(draft.to ?? draft.from),
                    )
                  : "Pick a start date"}
              </span>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={apply} disabled={!draft?.from}>
                  Apply
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {hideRange && pending ? <Spinner className="size-3.5 text-muted-foreground" /> : null}
    </div>
  );
}
