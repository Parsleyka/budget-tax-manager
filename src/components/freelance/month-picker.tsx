"use client";

import { MonthMultiSelect } from "@/components/shared/month-multi-select";
import { Spinner } from "@/components/ui/spinner";
import type { ISODate } from "@/lib/dates";
import { useFreelanceSelection } from "./selection-context";

// Light selected state (the shared picker fills selected months with the primary color): a subtle tint
// and a darker hairline; unselected chips stay quiet.
const LIGHT_SELECTION =
  "[&_button[aria-pressed=true]]:border-foreground/25 [&_button[aria-pressed=true]]:bg-accent [&_button[aria-pressed=true]]:text-foreground [&_button[aria-pressed=true]]:ring-0 [&_button[aria-pressed=false]]:text-muted-foreground";

/** Year select + month chips for the Freelancer page toolbar (state lives in the selection context). */
export function FreelanceMonthPicker({ years, today }: { years: number[]; today: ISODate }) {
  const { year, months, setMonths, changeYear, pending } = useFreelanceSelection();
  return (
    <div className="flex w-full max-w-3xl min-w-0 flex-col gap-1">
      <MonthMultiSelect
        year={year}
        years={years}
        onYearChange={changeYear}
        value={months}
        onChange={setMonths}
        today={today}
        disabled={pending}
        className={LIGHT_SELECTION}
      />
      {pending ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
          <Spinner className="size-3" /> Loading the selected year…
        </span>
      ) : null}
    </div>
  );
}
