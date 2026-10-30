"use client";

import { useRouter } from "next/navigation";
import type * as React from "react";
import { createContext, useContext, useMemo, useState, useTransition } from "react";
import type { ISOMonth } from "@/lib/dates";
import { calculateTaxes, type TaxCalculation } from "@/lib/tax/engine";
import type { Income, Settings } from "@/lib/types";
import { encodeMonthsParam, esvParamSuffix, inMonths } from "./model";

interface FreelanceSelection {
  year: number;
  /** Selected months (sorted YYYY-MM). */
  months: ISOMonth[];
  setMonths: (months: ISOMonth[]) => void;
  changeYear: (year: number) => void;
  /** A year change is loading on the server. */
  pending: boolean;
  /** Instant client-side tax calculation for the selected months. */
  calc: TaxCalculation;
  /** Freelance incomes dated in the selected months. */
  selectedIncomes: Income[];
}

const SelectionContext = createContext<FreelanceSelection | null>(null);

export function useFreelanceSelection(): FreelanceSelection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useFreelanceSelection must be used inside <FreelanceSelectionProvider>");
  return ctx;
}

export interface FreelanceSelectionProviderProps {
  year: number;
  initialMonths: ISOMonth[];
  /** Every freelance income of `year` (the limit is cumulative from 1 January). */
  incomes: Income[];
  settings: Settings;
  children: React.ReactNode;
}

/**
 * Holds the month selection of the Freelancer page and recomputes taxes on the client.
 * The selection is mirrored into `?months=` with history.replaceState (no server round trip),
 * so a reload or a shared link keeps it. Render it with `key={year}` so a year change resets it.
 */
export function FreelanceSelectionProvider({ year, initialMonths, incomes, settings, children }: FreelanceSelectionProviderProps) {
  const router = useRouter();
  const [months, setMonthsState] = useState<ISOMonth[]>(initialMonths);
  const [pending, startTransition] = useTransition();

  const calc = useMemo(() => calculateTaxes({ incomes, months, settings }), [incomes, months, settings]);
  const selectedIncomes = useMemo(() => inMonths(incomes, months), [incomes, months]);

  const value = useMemo<FreelanceSelection>(
    () => ({
      year,
      months,
      calc,
      selectedIncomes,
      pending,
      setMonths(next) {
        setMonthsState(next);
        // Keep the "Include ЄСВ" switch (`esv=1`) — it lives in the URL too.
        const esv = esvParamSuffix(window.location.search);
        window.history.replaceState(null, "", `${window.location.pathname}?year=${year}&months=${encodeMonthsParam(next, year)}${esv}`);
      },
      changeYear(next) {
        if (next === year) return;
        const esv = esvParamSuffix(window.location.search);
        startTransition(() => router.push(`/freelance?year=${next}${esv}`, { scroll: false }));
      },
    }),
    [year, months, calc, selectedIncomes, pending, router],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
