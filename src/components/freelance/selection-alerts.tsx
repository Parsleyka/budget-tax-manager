"use client";

import { CircleAlert, TriangleAlert } from "lucide-react";
import type { TaxWarning } from "@/lib/tax/engine";
import { cn } from "@/lib/utils";
import { useFreelanceSelection } from "./selection-context";

const SEVERITY_ORDER: Record<TaxWarning["severity"], number> = { critical: 0, warning: 1, info: 2 };

const TITLES: Record<TaxWarning["code"], string> = {
  "limit-80": "80% of the income limit used",
  "limit-90": "90% of the income limit used",
  "limit-reached": "Income limit reached",
  "limit-exceeded": "Income limit exceeded",
  "general-system": "Switch to the general system required",
  "rules-assumed": "Tax rules assumed",
  "income-before-registration": "Income before ФОП registration",
  "military-service": "Military service months",
};

/**
 * Engine warnings for the current selection, one line each (the detail is in the tooltip and for screen
 * readers). "80% used" is left out: the income-limit figure already shows it.
 */
export function SelectionAlerts() {
  const { calc } = useFreelanceSelection();
  const warnings = calc.warnings.filter((w) => w.code !== "limit-80").sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Tax warnings">
      {warnings.map((w, i) => {
        const Icon = w.severity === "info" ? TriangleAlert : CircleAlert;
        return (
          <li
            key={`${w.code}-${w.year ?? ""}-${i}`}
            title={w.message}
            className={cn(
              "flex items-center gap-2",
              w.severity === "critical" ? "text-negative" : w.severity === "warning" ? "text-warning" : "text-muted-foreground",
            )}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span className="font-medium">{TITLES[w.code]}</span>
            <span className="sr-only">: {w.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
