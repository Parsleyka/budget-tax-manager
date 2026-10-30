/**
 * Pure view helpers for the Income page (no React, no server code) — shared by the Server Component
 * page and the client table, and unit-tested in `income-view.test.ts`.
 */
import { formatDate } from "@/lib/dates";
import { INCOME_KIND_LABELS } from "@/lib/labels";
import { CURRENCIES, formatMoney, sumMoney } from "@/lib/money";
import type { Currency, Income, IncomeKind } from "@/lib/types";
import type { IncomeKindFilter } from "@/server/queries";

export const INCOME_KIND_FILTERS = ["all", "salary", "freelance"] as const satisfies readonly IncomeKindFilter[];

export const INCOME_KIND_FILTER_LABELS: Record<IncomeKindFilter, string> = {
  all: "All",
  salary: "Salary",
  freelance: "Freelance",
};

/** Unknown / missing values fall back to "all" (same rule as the loader). */
export function parseIncomeKindFilter(value: string | null | undefined): IncomeKindFilter {
  return value === "salary" || value === "freelance" ? value : "all";
}

type ParamsInput = string | URLSearchParams | Record<string, string | string[] | undefined>;

function toSearchParams(input: ParamsInput): URLSearchParams {
  if (typeof input === "string" || input instanceof URLSearchParams) return new URLSearchParams(input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return params;
}

/** Incomes rendered per page of the list (`?limit=` adds more). */
export const INCOME_PAGE_SIZE = 50;
/** Most incomes one page renders. */
export const INCOME_MAX_LIMIT = 1000;

/** `?limit=` → rows to render: an integer in [INCOME_PAGE_SIZE, INCOME_MAX_LIMIT] (default the page size). */
export function parseIncomeLimit(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !/^\d{1,6}$/.test(v)) return INCOME_PAGE_SIZE;
  return Math.min(INCOME_MAX_LIMIT, Math.max(INCOME_PAGE_SIZE, Number(v)));
}

/**
 * URL for the income page with `patch` applied to the current search params. Every other param
 * (`period`, `from`, `to`, …) is preserved. `kind: "all"` and `null` values remove the param.
 * Changing the kind or the period starts the list from its first page again (drops `limit`).
 */
export function incomeHref(
  current: ParamsInput,
  patch: { kind?: IncomeKindFilter; period?: string | null; limit?: number | null },
  pathname = "/income",
): string {
  const params = toSearchParams(current);
  if (patch.kind !== undefined || patch.period !== undefined) params.delete("limit");
  if (patch.limit !== undefined) {
    if (patch.limit === null) params.delete("limit");
    else params.set("limit", String(patch.limit));
  }
  if (patch.kind !== undefined) {
    if (patch.kind === "all") params.delete("kind");
    else params.set("kind", patch.kind);
  }
  if (patch.period !== undefined) {
    params.delete("from");
    params.delete("to");
    if (patch.period === null) params.delete("period");
    else params.set("period", patch.period);
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Fields of an `IncomeRow` the helpers need (kept structural so tests can use plain incomes). */
export type IncomeRowLike = Pick<Income, "kind" | "currency" | "amount" | "amountUah" | "fee"> & {
  receivedUah: number;
  feeUah: number;
};

export interface CurrencyTotal {
  currency: Currency;
  /** Gross amount in the original currency ("before exchange"). */
  amount: number;
  /** Σ fees in that currency (0 when none). */
  fee: number;
  count: number;
}

export interface IncomeRowsSummary {
  count: number;
  /** Σ amountUah — salary + GROSS freelance ("after exchange"; the tax base for freelance). */
  totalUah: number;
  /** Σ fees in UAH (at each income's own rate). */
  feesUah: number;
  /** Σ UAH actually credited (totalUah − feesUah). */
  receivedUah: number;
  /** Original-currency totals, in UAH / USD / EUR order, only currencies that occur. */
  byCurrency: CurrencyTotal[];
  hasFees: boolean;
  /** Some row is not in UAH (the original amount / NBU rate columns are informative). */
  hasForeign: boolean;
}

/** Totals of the rows currently shown (the table footer). Exact money math via `sumMoney`. */
export function summarizeIncomeRows(rows: readonly IncomeRowLike[]): IncomeRowsSummary {
  const byCurrency: CurrencyTotal[] = [];
  for (const currency of CURRENCIES) {
    const list = rows.filter((r) => r.currency === currency);
    if (!list.length) continue;
    byCurrency.push({
      currency,
      amount: sumMoney(list.map((r) => r.amount)),
      fee: sumMoney(list.map((r) => r.fee ?? 0)),
      count: list.length,
    });
  }
  return {
    count: rows.length,
    totalUah: sumMoney(rows.map((r) => r.amountUah)),
    feesUah: sumMoney(rows.map((r) => r.feeUah)),
    receivedUah: sumMoney(rows.map((r) => r.receivedUah)),
    byCurrency,
    hasFees: rows.some((r) => !!r.fee),
    hasForeign: rows.some((r) => r.currency !== "UAH"),
  };
}

/** Column header for `counterparty`, matching the tab. */
export function counterpartyHeader(kind: IncomeKindFilter): string {
  return kind === "salary" ? "Employer" : kind === "freelance" ? "Client" : "Source";
}

/** Primary label of a row: the counterparty, else the kind ("Salary" / "Freelance"). */
export function incomeTitle(row: Pick<Income, "kind" | "counterparty">): string {
  return row.counterparty?.trim() || INCOME_KIND_LABELS[row.kind];
}

/** Lower-case noun for messages: "salary" / "freelance income". */
export function incomeNoun(kind: IncomeKind): string {
  return kind === "salary" ? "salary" : "freelance income";
}

/** "salary of 41 230,50 ₴ on 15 Oct 2026 (Company LLC)" — for aria-labels and confirmations. */
export function describeIncome(row: Pick<Income, "kind" | "amount" | "currency" | "date" | "counterparty">): string {
  const who = row.counterparty?.trim();
  const money = formatMoney(row.amount, row.currency);
  return `${incomeNoun(row.kind)} of ${money} on ${formatDate(row.date)}${who ? ` (${who})` : ""}`;
}

/** "3 incomes" / "1 income". */
export function pluralIncomes(count: number): string {
  return `${count} ${count === 1 ? "income" : "incomes"}`;
}

/** Why a just-saved income would not appear in the list (period / kind tab), or null when it is visible. */
export function incomeHiddenReason(
  income: Pick<Income, "date" | "kind">,
  view: { range: { from: string; to: string }; kind: IncomeKindFilter },
): string | null {
  if (income.date < view.range.from || income.date > view.range.to) {
    return `It's dated ${formatDate(income.date)}, outside the selected period.`;
  }
  if (view.kind !== "all" && view.kind !== income.kind) {
    return `It's ${income.kind === "salary" ? "a salary" : "freelance income"} — see the ${INCOME_KIND_FILTER_LABELS[income.kind]} or All tab.`;
  }
  return null;
}
