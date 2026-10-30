import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nowIso } from "@/lib/dates";
import { checkSnapshotIntegrity } from "@/lib/integrity";
import { ExportFileSchema, zodErrorSummary } from "@/lib/schemas";
import type { ActionResult, ExportFile } from "@/lib/types";
import { getDataDir } from "../config";
import { fileExists } from "../db/json-file";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import {
  ALL_DATA_FILES,
  COLLECTIONS,
  RATES_FILE,
  SETTINGS_FILE,
  dataFilePath,
  readRatesCache,
  readSnapshot,
  writeCollection,
  writeRatesCache,
  writeSettings,
} from "../db/store";
import { fail, guard, ok } from "./result";

/** Put the pre-import copy of `file` back (or remove it when it did not exist before). Tmp + rename. */
async function restoreFile(backupDir: string, file: string): Promise<void> {
  const target = dataFilePath(file);
  const saved = path.join(backupDir, file);
  if (await fileExists(saved)) {
    const tmp = `${target}.${process.pid}.restore.tmp`;
    await fs.copyFile(saved, tmp);
    await fs.rename(tmp, target);
  } else {
    await fs.rm(target, { force: true });
  }
}

/** Everything as one JSON document (GET /api/export). Includes the NBU cache. */
export async function exportData(): Promise<ExportFile> {
  const [snapshot, rates] = await Promise.all([readSnapshot(), readRatesCache()]);
  return { app: "budget-tax-manager", version: 1, exportedAt: nowIso(), data: { ...snapshot, rates } };
}

export interface ImportResult {
  /** Absolute path of the backup folder holding the previous files. */
  backupDir: string;
  counts: {
    accounts: number;
    incomes: number;
    expenses: number;
    categories: number;
    transfers: number;
    adjustments: number;
    debts: number;
    investmentFlows: number;
    valuations: number;
    rates: number;
  };
}

/** Copy every existing data file into data/backups/<timestamp>/. Returns the folder. */
export async function backupDataFiles(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(getDataDir(), "backups", stamp);
  await fs.mkdir(dir, { recursive: true });
  for (const file of ALL_DATA_FILES) {
    const src = dataFilePath(file);
    if (await fileExists(src)) await fs.copyFile(src, path.join(dir, file));
  }
  return dir;
}

/**
 * Validate the WHOLE payload (schema + referential integrity) before touching anything, back up
 * the current files, then replace each file atomically. `payload` may be the parsed object or the
 * raw JSON string. When the payload has no `rates`, the current NBU cache is kept.
 * All-or-nothing: if writing any file fails (disk full, permissions, a locked file…), every file
 * already replaced is restored from the backup before the failure is returned — the message says
 * whether that worked and where the backup is.
 */
export function importData(payload: unknown): Promise<ActionResult<ImportResult>> {
  return guard(async () => {
    let json = payload;
    if (typeof payload === "string") {
      try {
        json = JSON.parse(payload);
      } catch {
        return fail("The file is not valid JSON.");
      }
    }
    const parsed = ExportFileSchema.safeParse(json);
    if (!parsed.success) return fail(`The file is not a valid export: ${zodErrorSummary(parsed.error, 5)}`);
    const { data } = parsed.data;
    const problems = checkSnapshotIntegrity(data);
    if (problems.length) {
      const more = problems.length > 5 ? ` (+${problems.length - 5} more)` : "";
      return fail(`The file has integrity problems: ${problems.slice(0, 5).join("; ")}${more}`);
    }
    return withLock(DB_WRITE_LOCK, async () => {
      const backupDir = await backupDataFiles();
      const newRates = data.rates;
      const steps: [file: string, write: () => Promise<void>][] = [
        [COLLECTIONS.accounts.file, () => writeCollection("accounts", data.accounts)],
        [COLLECTIONS.categories.file, () => writeCollection("categories", data.categories)],
        [COLLECTIONS.incomes.file, () => writeCollection("incomes", data.incomes)],
        [COLLECTIONS.expenses.file, () => writeCollection("expenses", data.expenses)],
        [COLLECTIONS.transfers.file, () => writeCollection("transfers", data.transfers)],
        [COLLECTIONS.adjustments.file, () => writeCollection("adjustments", data.adjustments)],
        [COLLECTIONS.debts.file, () => writeCollection("debts", data.debts)],
        [COLLECTIONS.investmentFlows.file, () => writeCollection("investmentFlows", data.investmentFlows)],
        [COLLECTIONS.valuations.file, () => writeCollection("valuations", data.valuations)],
        [SETTINGS_FILE, () => writeSettings(data.settings)],
        ...(newRates ? [[RATES_FILE, () => writeRatesCache(newRates)] as [string, () => Promise<void>]] : []),
      ];
      const touched: string[] = [];
      try {
        for (const [file, write] of steps) {
          touched.push(file); // a failed write may still have replaced the file
          await write();
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error("[budget] import failed, restoring the previous files", err);
        const notRestored: string[] = [];
        for (const file of touched) {
          try {
            await restoreFile(backupDir, file);
          } catch (restoreErr) {
            console.error(`[budget] could not restore ${file} from ${backupDir}`, restoreErr);
            notRestored.push(file);
          }
        }
        return notRestored.length === 0
          ? fail(`Import failed (${reason}). Nothing was changed — your previous data was restored. A backup is in ${backupDir}.`)
          : fail(
              `Import failed (${reason}) and ${notRestored.join(", ")} could not be restored automatically. ` +
                `Copy the files from ${backupDir} back into the data folder.`,
            );
      }
      const rates = data.rates ?? (await readRatesCache());
      return ok({
        backupDir,
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
          rates: Object.keys(rates.USD).length + Object.keys(rates.EUR).length + Object.keys(rates.PLN).length,
        },
      });
    });
  });
}
