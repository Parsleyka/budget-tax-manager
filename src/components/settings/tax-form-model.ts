/**
 * Pure model behind the Settings → Taxes form: string drafts ⇄ TaxSettings, validation that mirrors
 * `TaxSettingsSchema` / the updateSettings service (same "tax.<field>" error keys), and the ЄСВ
 * year preview. Isomorphic and framework-free so it can be unit-tested.
 */
import { isValidMonth, monthOf, monthsOfYear, type ISOMonth } from "@/lib/dates";
import { formatAmountTyping, hasAtMostDecimals, parseMoneyInput, sumMoney } from "@/lib/money";
import { TaxSettingsSchema, zodFieldErrors } from "@/lib/schemas";
import { esvForMonth, type EsvMonth } from "@/lib/tax/engine";
import type { EsvExemptPeriod, EsvMode, FieldErrors, TaxSettings } from "@/lib/types";

/** One exempt-period row as edited (months "YYYY-MM"; `to` empty = still exempt). */
export interface ExemptPeriodDraft {
  from: string;
  to: string | null;
  note: string;
  /** Military service: also no single tax / military levy for these months. */
  militaryService: boolean;
}

/** Form state: numbers are kept as the text the user typed. */
export interface TaxDraft {
  vatPayer: boolean;
  singleTaxOverrideOn: boolean;
  singleTaxOverride: string;
  militaryLevyEnabled: boolean;
  levyOverrideOn: boolean;
  levyOverride: string;
  militaryLevyEndDate: string | null;
  esvMode: EsvMode;
  employedFrom: string | null;
  employedTo: string | null;
  esvUncoveredMonths: string[];
  customBase: string;
  fopRegisteredOn: string | null;
  fopDeregisteredOn: string | null;
  esvExemptPeriods: ExemptPeriodDraft[];
  esv2024OptOut: boolean;
}

/** Field-error keys used by the form (identical to the server's "tax.<field>" keys). */
export const TAX_FIELD_KEYS = {
  singleTaxRateOverridePct: "tax.singleTaxRateOverridePct",
  militaryLevyRateOverridePct: "tax.militaryLevyRateOverridePct",
  militaryLevyEndDate: "tax.militaryLevyEndDate",
  esvMode: "tax.esvMode",
  employedFrom: "tax.employedFrom",
  employedTo: "tax.employedTo",
  esvUncoveredMonths: "tax.esvUncoveredMonths",
  esvCustomMonthlyBase: "tax.esvCustomMonthlyBase",
  fopRegisteredOn: "tax.fopRegisteredOn",
  fopDeregisteredOn: "tax.fopDeregisteredOn",
  esvExemptPeriods: "tax.esvExemptPeriods",
} as const;

/** Error key of one exempt-period field ("tax.esvExemptPeriods.0.to"). */
export function exemptPeriodKey(index: number, field: "from" | "to" | "note"): string {
  return `${TAX_FIELD_KEYS.esvExemptPeriods}.${index}.${field}`;
}

/** 5 → "5", 1.5 → "1,5", null → "". */
export function percentToInput(pct: number | null): string {
  return pct === null ? "" : String(pct).replace(".", ",");
}

/** UAH amount → "8 647,00" (comma decimals, grouped by thousands); null → "". */
export function amountToInput(amount: number | null): string {
  return amount === null ? "" : formatAmountTyping(amount.toFixed(2).replace(".", ","));
}

/** "5", "1,5", "2.25", "3 %" → number in 0..100 with ≤ 2 decimals; null when invalid. */
export function parsePercentInput(input: string): number | null {
  const n = parseMoneyInput(input.replace(/%/g, ""));
  if (n === null || n < 0 || n > 100 || !hasAtMostDecimals(n, 2)) return null;
  return n;
}

export function draftFromTax(tax: TaxSettings): TaxDraft {
  return {
    vatPayer: tax.vatPayer,
    singleTaxOverrideOn: tax.singleTaxRateOverridePct !== null,
    singleTaxOverride: percentToInput(tax.singleTaxRateOverridePct),
    militaryLevyEnabled: tax.militaryLevyEnabled,
    levyOverrideOn: tax.militaryLevyRateOverridePct !== null,
    levyOverride: percentToInput(tax.militaryLevyRateOverridePct),
    militaryLevyEndDate: tax.militaryLevyEndDate,
    esvMode: tax.esvMode,
    employedFrom: tax.employedFrom,
    employedTo: tax.employedTo,
    esvUncoveredMonths: normalizeMonths(tax.esvUncoveredMonths),
    customBase: amountToInput(tax.esvCustomMonthlyBase),
    fopRegisteredOn: tax.fopRegisteredOn,
    fopDeregisteredOn: tax.fopDeregisteredOn ?? null,
    esvExemptPeriods: (tax.esvExemptPeriods ?? []).map((p) => ({
      from: p.from,
      to: p.to,
      note: p.note ?? "",
      militaryService: p.militaryService ?? false,
    })),
    esv2024OptOut: tax.esv2024OptOut ?? false,
  };
}

/** Draft rows → stored periods (note trimmed, empty note and an unset military flag dropped), sorted by start month. */
function exemptPeriodsFromDraft(rows: readonly ExemptPeriodDraft[]): EsvExemptPeriod[] {
  return rows
    .map((r) => {
      const note = r.note.trim();
      return { from: r.from, to: r.to || null, ...(note ? { note } : {}), ...(r.militaryService ? { militaryService: true } : {}) };
    })
    .sort((a, b) => a.from.localeCompare(b.from));
}

export type DraftResult = { ok: true; tax: TaxSettings } | { ok: false; errors: FieldErrors };

/**
 * Strict conversion for saving. Mirrors the server: percents 0..100 (≤ 2 decimals), custom base
 * > 0 (≤ 2 decimals) and required in custom mode, "employed to" not before "employed from".
 * A custom base typed while another mode is selected is kept only when it is valid.
 */
export function taxFromDraft(draft: TaxDraft): DraftResult {
  const errors: FieldErrors = {};
  const add = (key: string, message: string) => {
    (errors[key] ??= []).push(message);
  };

  let singleTaxRateOverridePct: number | null = null;
  if (draft.singleTaxOverrideOn) {
    singleTaxRateOverridePct = parsePercentInput(draft.singleTaxOverride);
    if (singleTaxRateOverridePct === null) {
      add(TAX_FIELD_KEYS.singleTaxRateOverridePct, "Enter a percent between 0 and 100 (at most 2 decimals)");
    }
  }

  let militaryLevyRateOverridePct: number | null = null;
  if (draft.levyOverrideOn) {
    militaryLevyRateOverridePct = parsePercentInput(draft.levyOverride);
    if (militaryLevyRateOverridePct === null) {
      add(TAX_FIELD_KEYS.militaryLevyRateOverridePct, "Enter a percent between 0 and 100 (at most 2 decimals)");
    }
  }

  const baseText = draft.customBase.trim();
  const parsedBase = baseText === "" ? null : parseMoneyInput(baseText);
  const validBase = parsedBase !== null && parsedBase > 0 ? parsedBase : null;
  if (draft.esvMode === "custom") {
    if (baseText === "") add(TAX_FIELD_KEYS.esvCustomMonthlyBase, "Enter the monthly base");
    else if (validBase === null) add(TAX_FIELD_KEYS.esvCustomMonthlyBase, "Enter an amount greater than 0 with at most 2 decimals");
  }

  const tax: TaxSettings = {
    vatPayer: draft.vatPayer,
    singleTaxRateOverridePct,
    militaryLevyEnabled: draft.militaryLevyEnabled,
    militaryLevyRateOverridePct,
    militaryLevyEndDate: draft.militaryLevyEndDate || null,
    esvMode: draft.esvMode,
    employedFrom: draft.employedFrom || null,
    employedTo: draft.employedTo || null,
    esvUncoveredMonths: normalizeMonths(draft.esvUncoveredMonths),
    esvCustomMonthlyBase: validBase,
    fopRegisteredOn: draft.fopRegisteredOn || null,
    fopDeregisteredOn: draft.fopDeregisteredOn || null,
    esvExemptPeriods: exemptPeriodsFromDraft(draft.esvExemptPeriods),
    esv2024OptOut: draft.esv2024OptOut,
  };
  // Validate the rows in the order they are shown, so error keys match the rendered row index.
  draft.esvExemptPeriods.forEach((r, i) => {
    if (!isValidMonth(r.from)) add(exemptPeriodKey(i, "from"), "Choose the first exempt month");
    else if (r.to && isValidMonth(r.to) && r.to < r.from) add(exemptPeriodKey(i, "to"), "“To” must not be before “From”");
  });

  const check = TaxSettingsSchema.safeParse(tax);
  if (!check.success) {
    for (const [key, messages] of Object.entries(zodFieldErrors(check.error))) {
      // Period rows are validated above against the displayed order (the stored list is sorted).
      if (key.startsWith("esvExemptPeriods.") && Object.keys(errors).some((k) => k.startsWith(TAX_FIELD_KEYS.esvExemptPeriods))) continue;
      for (const m of messages) add(key === "_" ? "_" : `tax.${key}`, m);
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, tax };
}

/**
 * Lenient conversion for live previews: never fails. Invalid numbers fall back to `fallback`'s
 * value (so the preview keeps showing the saved behaviour while the user is typing).
 */
export function previewTaxFromDraft(draft: TaxDraft, fallback: TaxSettings): TaxSettings {
  const single = draft.singleTaxOverrideOn
    ? (parsePercentInput(draft.singleTaxOverride) ?? fallback.singleTaxRateOverridePct)
    : null;
  const levy = draft.levyOverrideOn ? (parsePercentInput(draft.levyOverride) ?? fallback.militaryLevyRateOverridePct) : null;
  const base = parseMoneyInput(draft.customBase);
  return {
    vatPayer: draft.vatPayer,
    singleTaxRateOverridePct: single,
    militaryLevyEnabled: draft.militaryLevyEnabled,
    militaryLevyRateOverridePct: levy,
    militaryLevyEndDate: draft.militaryLevyEndDate || null,
    esvMode: draft.esvMode,
    employedFrom: draft.employedFrom || null,
    employedTo: draft.employedTo || null,
    esvUncoveredMonths: normalizeMonths(draft.esvUncoveredMonths),
    esvCustomMonthlyBase: base !== null && base > 0 ? base : fallback.esvCustomMonthlyBase,
    fopRegisteredOn: draft.fopRegisteredOn || null,
    fopDeregisteredOn: draft.fopDeregisteredOn || null,
    // Rows still being edited (no valid start, or reversed) are ignored by the preview.
    esvExemptPeriods: exemptPeriodsFromDraft(
      draft.esvExemptPeriods.filter((r) => isValidMonth(r.from) && (!r.to || (isValidMonth(r.to) && r.to >= r.from))),
    ),
    esv2024OptOut: draft.esv2024OptOut,
  };
}

/** Structural equality of two tax settings (uncovered months compared as sorted sets). */
export function sameTax(a: TaxSettings, b: TaxSettings): boolean {
  return canonical(a) === canonical(b);
}

function canonical(t: TaxSettings): string {
  return JSON.stringify([
    t.vatPayer,
    t.singleTaxRateOverridePct,
    t.militaryLevyEnabled,
    t.militaryLevyRateOverridePct,
    t.militaryLevyEndDate,
    t.esvMode,
    t.employedFrom,
    t.employedTo,
    normalizeMonths(t.esvUncoveredMonths),
    t.esvCustomMonthlyBase,
    t.fopRegisteredOn,
    t.fopDeregisteredOn ?? null,
    (t.esvExemptPeriods ?? []).map((p) => [p.from, p.to, p.note ?? "", p.militaryService ?? false]),
    t.esv2024OptOut ?? false,
  ]);
}

/** De-duplicated, sorted months. */
export function normalizeMonths(months: readonly string[]): string[] {
  return [...new Set(months)].sort();
}

/** Add the month if absent, remove it if present (result sorted). */
export function toggleMonth(months: readonly string[], month: ISOMonth): string[] {
  return months.includes(month) ? months.filter((m) => m !== month) : normalizeMonths([...months, month]);
}

/** Month inside the "employed" window [employedFrom, employedTo] (month granularity, null = open). */
export function inEmploymentWindow(month: ISOMonth, tax: Pick<TaxSettings, "employedFrom" | "employedTo">): boolean {
  const afterStart = tax.employedFrom === null || month >= monthOf(tax.employedFrom);
  const beforeEnd = tax.employedTo === null || month <= monthOf(tax.employedTo);
  return afterStart && beforeEnd;
}

/**
 * Whether the user can flip a month's "not covered by the employer" flag: employed mode only,
 * not before the ФОП registration month, and inside the employment window — or already flagged
 * (so stale flags can always be removed).
 */
export function canToggleUncovered(month: ISOMonth, tax: TaxSettings): boolean {
  if (tax.esvMode !== "employed") return false;
  if (tax.esvUncoveredMonths.includes(month)) return true;
  if (tax.fopRegisteredOn && month < monthOf(tax.fopRegisteredOn)) return false;
  return inEmploymentWindow(month, tax);
}

export interface EsvYearPreview {
  year: number;
  months: EsvMonth[];
  /** Σ per quarter (Q1..Q4). */
  quarters: number[];
  total: number;
  /** Months that owe ЄСВ. */
  dueCount: number;
}

/** ЄСВ for each month of `year` under `tax` (exactly what the tax engine charges). */
export function esvYearPreview(year: number, tax: TaxSettings): EsvYearPreview {
  const months = monthsOfYear(year).map((m) => esvForMonth(m, tax));
  const quarters = [0, 1, 2, 3].map((q) => sumMoney(months.slice(q * 3, q * 3 + 3).map((m) => m.amount)));
  return {
    year,
    months,
    quarters,
    total: sumMoney(months.map((m) => m.amount)),
    dueCount: months.filter((m) => m.amount > 0).length,
  };
}
