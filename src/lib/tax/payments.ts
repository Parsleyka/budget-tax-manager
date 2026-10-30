/**
 * Paid-vs-due helpers shared by the Freelancer page and the Overview (pure + isomorphic):
 * overdue items, the next actionable deadline, and the quarter options of "Record tax payment".
 * They work across years — Q4 is paid in Jan–Feb of the next year, and an unpaid quarter of an
 * earlier year must never disappear just because the default view moved on to a new year.
 */
import { parseQuarterKey, quarterEnd, quarterKey, quarterMonths, QUARTERS, type ISODate, type Quarter, type QuarterKey } from "../dates";
import { fromMinor, toMinor } from "../money";
import type { Settings, TaxKind, TaxSettings } from "../types";
import type { TaxDeadline } from "./deadlines";
import { esvForMonth, type QuarterlyDeclaration, type QuarterPaymentStatus } from "./engine";

export const TAX_KINDS: readonly TaxKind[] = ["single_tax", "military_levy", "esv"];

/** Whether the quarter `period` has finished on `today`. */
export function isQuarterEnded(period: QuarterKey, today: ISODate): boolean {
  const { year, quarter } = parseQuarterKey(period);
  return quarterEnd(year, quarter) < today;
}

/** Declaration name per quarter (the form is cumulative from 1 January). */
export function declarationName(quarter: Quarter): string {
  return quarter === 1 ? "Q1 declaration" : quarter === 2 ? "Half-year declaration" : quarter === 3 ? "9-month declaration" : "Annual declaration";
}

export interface OverdueItem {
  period: QuarterKey;
  kind: TaxKind;
  outstanding: number;
  deadline: ISODate;
}

/** Every overdue (deadline passed, still outstanding) payment, oldest period first (any number of years). */
export function overdueItems(statuses: readonly QuarterPaymentStatus[]): OverdueItem[] {
  const out: OverdueItem[] = [];
  for (const s of [...statuses].sort((a, b) => a.period.localeCompare(b.period))) {
    for (const k of TAX_KINDS) {
      const i = s.items[k];
      if (i.overdue) out.push({ period: s.period, kind: k, outstanding: i.outstanding, deadline: i.deadline });
    }
  }
  return out;
}

// ------------------------------------------------------------------ own ЄСВ relevance

/**
 * Own ЄСВ matters for a quarter when anything is due, paid or covered by credit for it. Not the case
 * when every month is exempt — e.g. an employer pays ЄСВ (mode "employed", Law 2464-VI art. 4 ч. 6)
 * or mode "exempt" — so the UI hides empty ЄСВ rows, lines and deadlines. Unknown status → true.
 */
export function esvApplies(status: Pick<QuarterPaymentStatus, "items"> | undefined): boolean {
  if (!status) return true;
  const e = status.items.esv;
  return e.due > 0 || e.paid > 0 || e.creditApplied > 0;
}

/**
 * Whether any quarter of `year` has own ЄСВ — otherwise the annual declaration has no Додаток 1
 * (research/tax-rules.md §3.3). No statuses for the year → true (unknown).
 */
export function yearHasEsv(statuses: readonly QuarterPaymentStatus[], year: number): boolean {
  const ofYear = statuses.filter((s) => parseQuarterKey(s.period).year === year);
  return ofYear.length === 0 || ofYear.some((s) => esvApplies(s));
}

/** Drop "Pay ЄСВ" deadlines of quarters with no own ЄСВ due or paid (filings and other payments stay). */
export function relevantDeadlines<T extends Pick<TaxDeadline, "kind" | "period">>(
  deadlines: readonly T[],
  statuses: readonly QuarterPaymentStatus[],
): T[] {
  return deadlines.filter((d) => d.kind !== "esv" || esvApplies(statuses.find((s) => s.period === d.period)));
}

// ------------------------------------------------------------------ optional ЄСВ preview

/**
 * The saved ЄСВ mode owes nothing — an employer pays it ("employed") or "exempt" — so the Freelancer
 * page offers an "Include ЄСВ" switch that previews the minimum ЄСВ as an optional extra (view only).
 */
export function esvOptionalAvailable(tax: Pick<TaxSettings, "esvMode">): boolean {
  return tax.esvMode === "employed" || tax.esvMode === "exempt";
}

/** The same settings with the minimum ЄСВ every month (registration / exempt periods still apply). */
export function withMinimumEsv(settings: Settings): Settings {
  return { ...settings, tax: { ...settings.tax, esvMode: "minimum" } };
}

/** Minimum ЄСВ per quarter of `years` — the amounts of the optional preview (0-quarters left out). */
export function optionalEsvByQuarter(years: Iterable<number>, settings: Settings): Record<QuarterKey, number> {
  const preview = withMinimumEsv(settings);
  const out: Record<QuarterKey, number> = {};
  for (const year of new Set(years)) {
    for (const q of QUARTERS) {
      const minor = quarterMonths(year, q).reduce((sum, m) => sum + toMinor(esvForMonth(m, preview).amount), 0);
      if (minor > 0) out[quarterKey(year, q)] = fromMinor(minor);
    }
  }
  return out;
}

/** Σ outstanding of overdue items. */
export function overdueTotal(items: readonly OverdueItem[]): number {
  return fromMinor(items.reduce((sum, i) => sum + toMinor(i.outstanding), 0));
}

/** Outstanding amount behind a deadline: payment → single tax + levy; ЄСВ → ЄСВ; filing → null. */
export function deadlineOutstanding(
  deadline: Pick<TaxDeadline, "kind" | "period">,
  statuses: readonly QuarterPaymentStatus[],
): { outstanding: number; due: number } | null {
  if (deadline.kind === "filing") return null;
  const s = statuses.find((x) => x.period === deadline.period);
  if (!s) return null;
  const kinds: TaxKind[] = deadline.kind === "payment" ? ["single_tax", "military_levy"] : ["esv"];
  return {
    outstanding: fromMinor(kinds.reduce((sum, k) => sum + toMinor(s.items[k].outstanding), 0)),
    due: fromMinor(kinds.reduce((sum, k) => sum + toMinor(s.items[k].due), 0)),
  };
}

/**
 * The next deadline that needs action: a filing (always required — even a zero declaration), or a
 * payment with something outstanding (or unknown status, e.g. a period of another year).
 * `deadlines` are the upcoming ones (≥ today), sorted by date.
 */
export function pickNextDeadline(
  deadlines: readonly TaxDeadline[],
  statuses: readonly QuarterPaymentStatus[],
): TaxDeadline | null {
  for (const d of deadlines) {
    const o = deadlineOutstanding(d, statuses);
    if (d.kind === "filing" || o === null || o.outstanding > 0) return d;
  }
  return null;
}

export interface PaymentQuarterOption {
  period: QuarterKey;
  quarter: Quarter;
  /** "Q3 2026 · 9-month declaration". */
  label: string;
  ended: boolean;
  paymentDeadline: ISODate;
  esvDeadline: ISODate;
  items: Record<TaxKind, { due: number; paid: number; outstanding: number }>;
}

/** Quarter options (with due / paid / outstanding per kind) for the "Record tax payment" form. */
export function paymentQuarterOptions(
  declaration: QuarterlyDeclaration,
  statuses: readonly QuarterPaymentStatus[],
  today: ISODate,
): PaymentQuarterOption[] {
  return declaration.quarters.map((q) => {
    const s = statuses.find((x) => x.period === q.period);
    const item = (k: TaxKind) => {
      const i = s?.items[k];
      return { due: i?.due ?? 0, paid: i?.paid ?? 0, outstanding: i?.outstanding ?? 0 };
    };
    return {
      period: q.period,
      quarter: q.quarter,
      label: `Q${q.quarter} ${declaration.year} · ${declarationName(q.quarter)}`,
      ended: isQuarterEnded(q.period, today),
      paymentDeadline: q.deadlines.payment,
      esvDeadline: q.deadlines.esv,
      items: { single_tax: item("single_tax"), military_levy: item("military_levy"), esv: item("esv") },
    };
  });
}

/** `paymentQuarterOptions` of several years, oldest quarter first (duplicate years ignored). */
export function paymentQuarterOptionsForYears(
  declarations: readonly QuarterlyDeclaration[],
  statuses: readonly QuarterPaymentStatus[],
  today: ISODate,
): PaymentQuarterOption[] {
  const seen = new Set<number>();
  return [...declarations]
    .sort((a, b) => a.year - b.year)
    .filter((d) => (seen.has(d.year) ? false : (seen.add(d.year), true)))
    .flatMap((d) => paymentQuarterOptions(d, statuses, today));
}

/**
 * Period to preselect in "Record tax payment": the oldest finished quarter with something outstanding
 * (across every year offered — in Jan–Feb that is last year's Q4), else the latest finished quarter,
 * else the first quarter offered.
 */
export function defaultPaymentPeriod(options: readonly PaymentQuarterOption[]): QuarterKey | null {
  if (options.length === 0) return null;
  const outstanding = (o: PaymentQuarterOption) => TAX_KINDS.some((k) => o.items[k].outstanding > 0);
  const ended = options.filter((o) => o.ended);
  return (ended.find(outstanding) ?? ended.at(-1) ?? options[0]).period;
}
