import "server-only";
import path from "node:path";

/**
 * Directory holding the JSON data files. `BUDGET_DATA_DIR` (absolute or relative to cwd)
 * overrides the default `<cwd>/data`. Read on every call so tests / e2e can point it elsewhere.
 */
export function getDataDir(): string {
  const fromEnv = process.env.BUDGET_DATA_DIR;
  return path.resolve(fromEnv && fromEnv.trim() !== "" ? fromEnv : path.join(process.cwd(), "data"));
}
