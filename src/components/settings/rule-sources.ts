/**
 * Legal sources for the read-only rule tables on Settings → Taxes (research/tax-rules.md §1, §3, §4)
 * plus small pure helpers to label the МЗП schedule. Isomorphic, unit-tested.
 */
import { addMonths, formatMonth, monthName, monthNumber, yearOf, type ISOMonth } from "@/lib/dates";

/** Roman convocation → the numeric suffix zakon.rada.gov.ua uses (2755-VI → 2755-17). */
const CONVOCATION_SUFFIX: Record<string, number> = { VI: 17, VII: 18, VIII: 19, IX: 20 };

/** The Tax Code of Ukraine (ПКУ) is Law 2755-VI. */
export const TAX_CODE_URL = "https://zakon.rada.gov.ua/laws/show/2755-17";

/**
 * Link to the first law number found in a citation ("Law 4695-IX art. 8" → …/laws/show/4695-20).
 * Citations of the Tax Code ("ПКУ …") link to 2755-17. null when nothing is recognised.
 */
export function lawUrl(citation: string): string | null {
  const m = /(\d{3,5})-(VIII|VII|VI|IX)(?![A-Z])/.exec(citation);
  if (m) return `https://zakon.rada.gov.ua/laws/show/${m[1]}-${CONVOCATION_SUFFIX[m[2]]}`;
  if (/ПКУ/.test(citation)) return TAX_CODE_URL;
  return null;
}

export interface RuleSource {
  /** Short citation shown in the table. */
  label: string;
  /** Optional official link (zakon.rada.gov.ua). */
  href?: string | null;
}

const src = (label: string, href?: string | null): RuleSource => ({ label, href: href === undefined ? lawUrl(label) : href });

/** Sources for the rate parameters (tax-rules.md §1). */
export const RATE_SOURCES = {
  singleTax: src("ПКУ п. 293.3 пп. 2"),
  singleTaxVat: src("ПКУ п. 293.3 пп. 1; п. 292.11 пп. 1"),
  overLimit: src("ПКУ п. 293.4 пп. 1; п. 293.8 пп. 3"),
  militaryLevy: src("ПКУ розд. XX підр. 10 п. 16-1 (Laws 4015-IX, 4113-IX)", TAX_CODE_URL),
  militaryLevyEnd: src("Law 4835-IX of 07.04.2026"),
  esv: src("Law 2464-VI art. 8 ч. 5; art. 7 ч. 1 п. 3"),
  minimumEsv: src("Law 2464-VI art. 1 ч. 1 п. 5"),
  limit: src("ПКУ п. 291.4 пп. 3"),
  employedExemption: src("Law 2464-VI art. 4 ч. 6"),
  employedExemptionAmendment: src("Law 4536-IX of 16.07.2025"),
} satisfies Record<string, RuleSource>;

/** Maximum ЄСВ base multiplier per year. */
export const MAX_BASE_SOURCES: Readonly<Record<number, RuleSource>> = {
  2024: src("Law 2464-VI art. 1 ч. 1 п. 4"),
  2025: src("Law 4059-IX art. 39 (15× cap suspended)"),
  2026: src("Law 4695-IX art. 32"),
};

/** Where each year's income limit was published. */
export const LIMIT_SOURCES: Readonly<Record<number, RuleSource>> = {
  2024: src("ДПС, 02.01.2024", null),
  2025: src("ДПС ЗІР", null),
  2026: src("ДПС ЗІР 107.05", null),
};

/** Deadline rules (tax-rules.md §3.1). */
export const DEADLINE_RULES: readonly { label: string; rule: string; source: RuleSource }[] = [
  {
    label: "File the declaration",
    rule: "40 days after the quarter ends (moved to the next business day)",
    source: src("ПКУ пп. 49.18.2, п. 49.20"),
  },
  {
    label: "Pay single tax + military levy",
    rule: "10 days after the unshifted 40th day (next business day)",
    source: src("ПКУ п. 57.1, п. 295.3"),
  },
  {
    label: "Pay ЄСВ",
    rule: "By the 19th of the month after the quarter (next business day)",
    source: src("Law 2464-VI art. 9 ч. 8; ДПС ЗІР 201.04.02"),
  },
];

/**
 * Human period for row `index` of the МЗП schedule: until the month before the next row's start.
 * "Jan – Mar 2024", "Apr – Dec 2024", "2025", and "From Jan 2026" for the last row.
 */
export function schedulePeriodLabel(froms: readonly ISOMonth[], index: number): string {
  const from = froms[index];
  const next = froms[index + 1];
  if (!next) return `From ${formatMonth(from)}`;
  const to = addMonths(next, -1);
  if (yearOf(from) === yearOf(to)) {
    if (monthNumber(from) === 1 && monthNumber(to) === 12) return String(yearOf(from));
    if (from === to) return formatMonth(from);
    return `${monthName(monthNumber(from))} – ${monthName(monthNumber(to))} ${yearOf(from)}`;
  }
  return `${formatMonth(from)} – ${formatMonth(to)}`;
}

/** Index of the schedule row in force in `month` (the latest `from` ≤ month), or -1. */
export function activeScheduleIndex(froms: readonly ISOMonth[], month: ISOMonth): number {
  let idx = -1;
  froms.forEach((f, i) => {
    if (f <= month) idx = i;
  });
  return idx;
}
