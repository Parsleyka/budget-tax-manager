"use client";

import { ChevronLeft, ChevronRight, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { formatMonth, monthName, monthOf, yearOf, type ISODate, type ISOMonth } from "@/lib/dates";
import { ESV_REASON_LABELS, type EsvReason } from "@/lib/tax/engine";
import { FIRST_RULES_YEAR, LAST_KNOWN_RULES_YEAR, isRulesAssumed } from "@/lib/tax/rules";
import type { TaxSettings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { canToggleUncovered, esvYearPreview } from "./tax-form-model";

const SHORT_REASON: Record<EsvReason, string> = {
  exempt: "Exempt",
  "before-registration": "Not registered",
  "after-deregistration": "Deregistered",
  "exempt-period": "Exempt period",
  "opt-out-2024": "2024 opt-out",
  employed: "Covered",
  uncovered: "Not covered",
  "outside-employment": "Outside job",
  minimum: "Minimum",
  custom: "Custom base",
};

export interface EsvMonthEditorProps {
  /** Settings as currently edited (unsaved draft) — the preview follows every change. */
  tax: TaxSettings;
  today: ISODate;
  /** Flip a month's "not covered by the employer" flag (employed mode). */
  onToggle: (month: ISOMonth) => void;
  disabled?: boolean;
}

/**
 * ЄСВ per month of one year under the edited settings (exactly what the tax engine charges). In
 * "employed" mode each month inside the employment window is a toggle: covered ↔ not covered.
 */
export function EsvMonthEditor({ tax, today, onToggle, disabled }: EsvMonthEditorProps) {
  const todayYear = yearOf(today);
  const minYear = Math.min(FIRST_RULES_YEAR, tax.fopRegisteredOn ? yearOf(tax.fopRegisteredOn) : FIRST_RULES_YEAR);
  const maxYear = todayYear + 1;
  const [yearState, setYear] = useState(todayYear);
  const year = Math.min(Math.max(yearState, minYear), maxYear);
  const preview = useMemo(() => esvYearPreview(year, tax), [year, tax]);
  const currentMonth = monthOf(today);
  const editable = tax.esvMode === "employed" && !disabled;
  const uncovered = tax.esvUncoveredMonths;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Previous year"
            disabled={year <= minYear}
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="w-12 text-center text-sm font-semibold tabular-nums" aria-live="polite">
            {year}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Next year"
            disabled={year >= maxYear}
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {year} total: <Money amount={preview.total} currency="UAH" className="font-medium text-foreground" /> ·{" "}
          {preview.dueCount} of 12 months due
        </p>
      </div>

      <div role="group" aria-label={`ЄСВ by month, ${year}`} className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
        {preview.months.map((m, i) => {
          const toggleable = editable && canToggleUncovered(m.month, tax);
          const isUncovered = m.reason === "uncovered";
          const future = m.month > currentMonth;
          const cellClass = cn(
            "flex min-w-0 flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left",
            m.amount === 0 ? "border-border bg-muted/40" : "border-border bg-background",
            isUncovered && "border-warning/60 bg-warning/10",
            future && "border-dashed",
          );
          const body = (
            <>
              <span className="flex w-full items-center justify-between gap-1 text-xs font-medium">
                {monthName(i + 1)}
                {m.month === currentMonth ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" title="Current month" aria-hidden />
                ) : isUncovered ? (
                  <TriangleAlert className="size-3 shrink-0 text-warning" aria-hidden />
                ) : null}
              </span>
              <Money amount={m.amount} currency="UAH" className={cn("text-sm", m.amount === 0 && "text-muted-foreground")} />
              <span className="w-full truncate text-[0.7rem] text-muted-foreground">{SHORT_REASON[m.reason]}</span>
            </>
          );
          const title = `${formatMonth(m.month, true)}: ${ESV_REASON_LABELS[m.reason]}`;
          return toggleable ? (
            <button
              key={m.month}
              type="button"
              aria-pressed={isUncovered}
              aria-label={`${formatMonth(m.month, true)} — not covered by the employer`}
              title={`${title}. Click to mark as ${isUncovered ? "covered" : "not covered"}.`}
              onClick={() => onToggle(m.month)}
              className={cn(
                cellClass,
                "cursor-pointer transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                isUncovered && "hover:bg-warning/15",
              )}
            >
              {body}
            </button>
          ) : (
            <div key={m.month} className={cellClass} title={title}>
              {body}
            </div>
          );
        })}
      </div>

      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {preview.quarters.map((q, i) => (
          <span key={i}>
            Q{i + 1} <Money amount={q} currency="UAH" className="text-foreground" />
          </span>
        ))}
      </p>

      {isRulesAssumed(year) ? (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {year > LAST_KNOWN_RULES_YEAR
            ? `${year} values are not law yet — the ${LAST_KNOWN_RULES_YEAR} minimum wage is assumed.`
            : `No verified rules for ${year} — the ${FIRST_RULES_YEAR} values are assumed.`}
        </p>
      ) : null}

      {tax.esvMode === "employed" && uncovered.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">Months marked as not covered</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Months not covered by the employer">
            {uncovered.map((m) => (
              <li key={m}>
                <span className="inline-flex h-6 items-center gap-1 rounded-full border border-warning/50 bg-warning/10 pr-0.5 pl-2 text-xs">
                  {formatMonth(m)}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-5 rounded-full"
                    aria-label={`Remove ${formatMonth(m, true)}`}
                    disabled={disabled}
                    onClick={() => onToggle(m)}
                  >
                    <X />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
