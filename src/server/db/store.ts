import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { nowIso } from "@/lib/dates";
import {
  AccountsFileSchema,
  AdjustmentsFileSchema,
  CategoriesFileSchema,
  DebtsFileSchema,
  ExpensesFileSchema,
  IncomesFileSchema,
  InvestmentFlowsFileSchema,
  RatesCacheSchema,
  SettingsFileSchema,
  TransfersFileSchema,
  ValuationsFileSchema,
  zodErrorSummary,
} from "@/lib/schemas";
import type { DataSnapshot, RatesCache, Settings } from "@/lib/types";
import { getDataDir } from "../config";
import { DataFileError, readJsonFile, writeJsonFileAtomic } from "./json-file";
import { withLock } from "./mutex";
import { seedAccounts, seedCategories, seedSettings } from "./seed";

/**
 * JSON-file store. One file per collection: `{ "version": 1, "items": [...] }`.
 * - Missing file → seeded (accounts/categories/settings) or created empty, under the file lock.
 * - Existing file that fails to parse/validate → DataFileError (never overwritten).
 * - Writes: validated, atomic (tmp + rename), one-step `.bak`, serialized per file.
 */
export const COLLECTIONS = {
  accounts: { file: "accounts.json", schema: AccountsFileSchema },
  incomes: { file: "incomes.json", schema: IncomesFileSchema },
  expenses: { file: "expenses.json", schema: ExpensesFileSchema },
  categories: { file: "categories.json", schema: CategoriesFileSchema },
  transfers: { file: "transfers.json", schema: TransfersFileSchema },
  adjustments: { file: "adjustments.json", schema: AdjustmentsFileSchema },
  debts: { file: "debts.json", schema: DebtsFileSchema },
  investmentFlows: { file: "investment-flows.json", schema: InvestmentFlowsFileSchema },
  valuations: { file: "valuations.json", schema: ValuationsFileSchema },
} as const;

export type CollectionName = keyof typeof COLLECTIONS;
export type CollectionItem<N extends CollectionName> = z.output<(typeof COLLECTIONS)[N]["schema"]>["items"][number];

export const SETTINGS_FILE = "settings.json";
export const RATES_FILE = "rates.json";
export const ALL_DATA_FILES = [...Object.values(COLLECTIONS).map((c) => c.file), SETTINGS_FILE, RATES_FILE];

export function dataFilePath(file: string): string {
  return path.join(getDataDir(), file);
}

function seedItems<N extends CollectionName>(name: N, now: string): CollectionItem<N>[] {
  if (name === "accounts") return seedAccounts(now) as CollectionItem<N>[];
  if (name === "categories") return seedCategories(now) as CollectionItem<N>[];
  return [];
}

/**
 * Thrown when a write would store invalid data (a bug or an unchecked derived value). The message
 * carries the file path for the terminal; `detail` is safe to show in the UI.
 */
export class InvalidWriteError extends Error {
  readonly detail: string;
  constructor(filePath: string, detail: string) {
    super(`Refusing to write invalid data to "${filePath}": ${detail}`);
    this.name = "InvalidWriteError";
    this.detail = detail;
  }
}

/** Validate before writing so a programming error can never persist invalid data. */
function assertValid<S extends z.ZodType>(schema: S, data: unknown, filePath: string): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new InvalidWriteError(filePath, zodErrorSummary(parsed.error));
  return parsed.data;
}

// ------------------------------------------------------------------ collections

export async function readCollection<N extends CollectionName>(name: N): Promise<CollectionItem<N>[]> {
  const { file, schema } = COLLECTIONS[name];
  const filePath = dataFilePath(file);
  const existing = await readJsonFile(filePath, schema);
  if (existing) return existing.items as CollectionItem<N>[];
  return withLock(filePath, async () => {
    const again = await readJsonFile(filePath, schema);
    if (again) return again.items as CollectionItem<N>[];
    const items = seedItems(name, nowIso());
    await writeJsonFileAtomic(filePath, assertValid(schema, { version: 1, items }, filePath));
    return items;
  });
}

/**
 * Read-modify-write a collection under its file lock. `fn` receives the current items and returns
 * the new items plus an optional result. Nothing is written when `fn` throws.
 */
export async function updateCollection<N extends CollectionName, R = void>(
  name: N,
  fn: (items: CollectionItem<N>[]) => { items: CollectionItem<N>[]; result?: R } | Promise<{ items: CollectionItem<N>[]; result?: R }>,
): Promise<R> {
  const { file, schema } = COLLECTIONS[name];
  const filePath = dataFilePath(file);
  // Make sure the file exists (seeded) before taking the lock.
  await readCollection(name);
  return withLock(filePath, async () => {
    const current = await readJsonFile(filePath, schema);
    const items = (current?.items ?? []) as CollectionItem<N>[];
    const { items: next, result } = await fn([...items]);
    await writeJsonFileAtomic(filePath, assertValid(schema, { version: 1, items: next }, filePath));
    return result as R;
  });
}

/** Replace a whole collection (import). */
export async function writeCollection<N extends CollectionName>(name: N, items: CollectionItem<N>[]): Promise<void> {
  const { file, schema } = COLLECTIONS[name];
  const filePath = dataFilePath(file);
  await withLock(filePath, async () => {
    await writeJsonFileAtomic(filePath, assertValid(schema, { version: 1, items }, filePath));
  });
}

// ------------------------------------------------------------------ settings

export async function readSettings(): Promise<Settings> {
  const filePath = dataFilePath(SETTINGS_FILE);
  const existing = await readJsonFile(filePath, SettingsFileSchema);
  if (existing) return existing.settings;
  const accounts = await readCollection("accounts");
  return withLock(filePath, async () => {
    const again = await readJsonFile(filePath, SettingsFileSchema);
    if (again) return again.settings;
    const settings = seedSettings(accounts, nowIso());
    await writeJsonFileAtomic(filePath, assertValid(SettingsFileSchema, { version: 1, settings }, filePath));
    return settings;
  });
}

export async function updateSettingsFile<R = void>(
  fn: (settings: Settings) => { settings: Settings; result?: R } | Promise<{ settings: Settings; result?: R }>,
): Promise<R> {
  const filePath = dataFilePath(SETTINGS_FILE);
  await readSettings();
  return withLock(filePath, async () => {
    const current = await readJsonFile(filePath, SettingsFileSchema);
    if (!current) throw new Error(`Settings file disappeared: ${filePath}`);
    const { settings, result } = await fn(structuredClone(current.settings));
    await writeJsonFileAtomic(filePath, assertValid(SettingsFileSchema, { version: 1, settings }, filePath));
    return result as R;
  });
}

export async function writeSettings(settings: Settings): Promise<void> {
  const filePath = dataFilePath(SETTINGS_FILE);
  await withLock(filePath, async () => {
    await writeJsonFileAtomic(filePath, assertValid(SettingsFileSchema, { version: 1, settings }, filePath));
  });
}

// ------------------------------------------------------------------ rates cache

export function emptyRatesCache(): RatesCache {
  return { version: 1, USD: {}, EUR: {}, PLN: {}, meta: {} };
}

/**
 * Read the NBU cache. Missing → empty. Unlike user data, a corrupt cache is NOT fatal: it is
 * renamed to `rates.json.corrupt-<timestamp>` (kept, never deleted) and an empty cache is used,
 * because every row can be re-fetched from the NBU.
 */
export async function readRatesCache(): Promise<RatesCache> {
  const filePath = dataFilePath(RATES_FILE);
  try {
    return (await readJsonFile(filePath, RatesCacheSchema)) ?? emptyRatesCache();
  } catch (err) {
    if (!(err instanceof DataFileError)) throw err;
    return withLock(filePath, async () => {
      try {
        return (await readJsonFile(filePath, RatesCacheSchema)) ?? emptyRatesCache();
      } catch (again) {
        if (!(again instanceof DataFileError)) throw again;
        const aside = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        await fs.rename(filePath, aside);
        console.warn(`[budget] ${again.message} Moved aside to ${aside}; starting with an empty rates cache.`);
        return emptyRatesCache();
      }
    });
  }
}

export async function updateRatesCache(fn: (cache: RatesCache) => RatesCache | void): Promise<void> {
  const filePath = dataFilePath(RATES_FILE);
  await readRatesCache();
  await withLock(filePath, async () => {
    const current = (await readJsonFile(filePath, RatesCacheSchema)) ?? emptyRatesCache();
    const next = fn(current) ?? current;
    await writeJsonFileAtomic(filePath, assertValid(RatesCacheSchema, next, filePath));
  });
}

export async function writeRatesCache(cache: RatesCache): Promise<void> {
  const filePath = dataFilePath(RATES_FILE);
  await withLock(filePath, async () => {
    await writeJsonFileAtomic(filePath, assertValid(RatesCacheSchema, cache, filePath));
  });
}

// ------------------------------------------------------------------ snapshot

/** Every collection + settings (seeding missing files). Throws DataFileError on corrupt files. */
export async function readSnapshot(): Promise<DataSnapshot> {
  // Accounts first: the settings seed depends on them.
  const accounts = await readCollection("accounts");
  // allSettled: never leave reads/seeding running in the background after a failure.
  const results = await Promise.allSettled([
    readCollection("incomes"),
    readCollection("expenses"),
    readCollection("categories"),
    readCollection("transfers"),
    readCollection("adjustments"),
    readCollection("debts"),
    readCollection("investmentFlows"),
    readCollection("valuations"),
    readSettings(),
  ] as const);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  const value = <T,>(r: PromiseSettledResult<T>) => (r as PromiseFulfilledResult<T>).value;
  return {
    accounts,
    incomes: value(results[0]),
    expenses: value(results[1]),
    categories: value(results[2]),
    transfers: value(results[3]),
    adjustments: value(results[4]),
    debts: value(results[5]),
    investmentFlows: value(results[6]),
    valuations: value(results[7]),
    settings: value(results[8]),
  };
}

export interface DataHealthProblem {
  file: string;
  message: string;
}

/** Validate every data file without throwing (for the layout's data-error screen). */
export async function checkDataHealth(): Promise<DataHealthProblem[]> {
  const problems: DataHealthProblem[] = [];
  const tryRead = async (file: string, read: () => Promise<unknown>) => {
    try {
      await read();
    } catch (err) {
      if (err instanceof DataFileError) problems.push({ file: dataFilePath(file), message: err.message });
      else throw err;
    }
  };
  await tryRead(COLLECTIONS.accounts.file, () => readCollection("accounts"));
  for (const name of ["incomes", "expenses", "categories", "transfers", "adjustments", "debts", "investmentFlows", "valuations"] as const) {
    await tryRead(COLLECTIONS[name].file, () => readCollection(name));
  }
  if (!problems.some((p) => p.file.endsWith(COLLECTIONS.accounts.file))) {
    await tryRead(SETTINGS_FILE, () => readSettings());
  }
  return problems;
}
