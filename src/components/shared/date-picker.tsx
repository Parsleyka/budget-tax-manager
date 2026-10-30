"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  addDays,
  compareDates,
  dateFromLocalDate,
  formatDate,
  formatWeekday,
  isValidDate,
  localDateFromDate,
  yearOf,
  type ISODate,
} from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  /** "YYYY-MM-DD" (or empty). */
  value: ISODate | null | undefined;
  onChange: (value: ISODate) => void;
  /** Today in Kyiv from the server loader — never computed on the client. */
  today: ISODate;
  id?: string;
  disabled?: boolean;
  /** Earliest selectable date (inclusive). */
  min?: ISODate;
  /** Latest selectable date (inclusive). */
  max?: ISODate;
  /**
   * First / last year offered in the month-year dropdowns. Defaults: the year of `min` / `max` when
   * given, otherwise min(2015, today − 5) … today + 1.
   */
  startYear?: number;
  endYear?: number;
  placeholder?: string;
  /** Sets aria-invalid (red ring) — pair with a <FieldError>. */
  invalid?: boolean;
  /** Show "Today" / "Yesterday" shortcuts under the calendar (default true). */
  shortcuts?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
}

/** Popover date picker over ISO date strings. Week starts on Monday; English labels. */
export function DatePicker({
  value,
  onChange,
  today,
  id,
  disabled,
  min,
  max,
  startYear,
  endYear,
  placeholder = "Pick a date",
  invalid,
  shortcuts = true,
  align = "start",
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value && isValidDate(value) ? value : null;
  const todayYear = yearOf(today);
  const fromYear = startYear ?? (min ? yearOf(min) : Math.min(2015, todayYear - 5));
  const toYear = Math.max(fromYear, endYear ?? (max ? yearOf(max) : todayYear + 1));

  const disabledMatchers = [
    ...(min ? [{ before: localDateFromDate(min) }] : []),
    ...(max ? [{ after: localDateFromDate(max) }] : []),
  ];
  const allowed = (d: ISODate) => (!min || compareDates(d, min) >= 0) && (!max || compareDates(d, max) <= 0);

  function pick(d: ISODate) {
    onChange(d);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            "w-full justify-start gap-2 bg-transparent px-2.5 font-normal hover:bg-muted/60 dark:bg-input/30",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays aria-hidden className="text-muted-foreground" />
          {selected ? (
            <span className="truncate">
              {formatDate(selected)} <span className="text-muted-foreground">· {formatWeekday(selected)}</span>
            </span>
          ) : (
            <span>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          required
          weekStartsOn={1}
          captionLayout="dropdown"
          startMonth={new Date(fromYear, 0)}
          endMonth={new Date(toYear, 11)}
          today={localDateFromDate(today)}
          defaultMonth={localDateFromDate(selected ?? today)}
          selected={selected ? localDateFromDate(selected) : undefined}
          onSelect={(d) => d && pick(dateFromLocalDate(d))}
          disabled={disabledMatchers}
        />
        {shortcuts ? (
          <div className="flex gap-2 border-t p-2">
            {[
              { label: "Today", date: today },
              { label: "Yesterday", date: addDays(today, -1) },
            ].map((s) => (
              <Button
                key={s.label}
                type="button"
                size="sm"
                variant="ghost"
                className="flex-1"
                disabled={!allowed(s.date)}
                onClick={() => pick(s.date)}
              >
                {s.label}
              </Button>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
