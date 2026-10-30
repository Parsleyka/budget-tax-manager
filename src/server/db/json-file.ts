import "server-only";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { zodErrorSummary } from "@/lib/schemas";

/** Thrown when a data file exists but cannot be parsed or fails validation. Never auto-repaired. */
export class DataFileError extends Error {
  readonly filePath: string;
  constructor(filePath: string, detail: string, options?: { cause?: unknown }) {
    super(
      `Data file "${filePath}" is corrupt or invalid: ${detail}. ` +
        `The app will not overwrite it — fix the file or restore it from "${path.basename(filePath)}.bak" (same folder).`,
      options,
    );
    this.name = "DataFileError";
    this.filePath = filePath;
  }
}

/**
 * Read + validate a JSON file. Returns null when the file does not exist.
 * Throws DataFileError on invalid JSON or schema mismatch.
 */
export async function readJsonFile<S extends z.ZodType>(filePath: string, schema: S): Promise<z.output<S> | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new DataFileError(filePath, `invalid JSON (${(err as Error).message})`, { cause: err });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new DataFileError(filePath, zodErrorSummary(parsed.error), { cause: parsed.error });
  return parsed.data;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic write: write `<file>.<pid>.<uuid>.tmp` in the same dir (fsync), copy the current file
 * to `<file>.bak` (one-step backup), then rename the temp file over the target.
 * Callers must hold the file's lock (see store.ts).
 */
export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (await fileExists(filePath)) await fs.copyFile(filePath, `${filePath}.bak`);
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
