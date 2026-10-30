/**
 * Client-side pre-check of an export file before import (Settings → Data). The server's
 * importData action validates again; this only lets the UI show what the file contains and
 * refuse obviously wrong files before asking for confirmation. Pure + isomorphic.
 */
import { checkSnapshotIntegrity } from "@/lib/integrity";
import { ExportFileSchema, zodErrorSummary } from "@/lib/schemas";

/** Matches the 25 MB server-action body limit in next.config.ts. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export interface ImportCounts {
  accounts: number;
  incomes: number;
  expenses: number;
  categories: number;
  transfers: number;
  adjustments: number;
  debts: number;
  investmentFlows: number;
  valuations: number;
  /** Cached NBU rates (USD + EUR); null when the file carries no rates cache. */
  rates: number | null;
}

export interface ImportSummary {
  exportedAt: string;
  counts: ImportCounts;
}

export type ImportInspection = { ok: true; summary: ImportSummary } | { ok: false; error: string };

/** Parse + validate the text of an export file (schema and referential integrity). */
export function inspectImportFile(text: string): ImportInspection {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  const parsed = ExportFileSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: `The file is not a valid Budget & Tax export: ${zodErrorSummary(parsed.error, 3)}` };
  }
  const { data, exportedAt } = parsed.data;
  const problems = checkSnapshotIntegrity(data);
  if (problems.length) {
    const more = problems.length > 3 ? ` (+${problems.length - 3} more)` : "";
    return { ok: false, error: `The file has integrity problems: ${problems.slice(0, 3).join("; ")}${more}` };
  }
  return {
    ok: true,
    summary: {
      exportedAt,
      counts: {
        accounts: data.accounts.length,
        incomes: data.incomes.length,
        expenses: data.expenses.length,
        categories: data.categories.length,
        transfers: data.transfers.length,
        adjustments: data.adjustments.length,
        debts: data.debts.length,
        investmentFlows: data.investmentFlows.length,
        valuations: data.valuations.length,
        rates: data.rates ? Object.keys(data.rates.USD).length + Object.keys(data.rates.EUR).length + Object.keys(data.rates.PLN).length : null,
      },
    },
  };
}

/** 0 → "0 B", 1536 → "1.5 KB", 2_400_000 → "2.3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** "1 account", "3 spendings". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
