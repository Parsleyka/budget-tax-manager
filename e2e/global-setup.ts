import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { E2E_DATA_DIR } from "../playwright.config";

/** Start every run from a fresh install: wipe the e2e data dir (never the real ./data). */
export default function globalSetup() {
  if (path.basename(E2E_DATA_DIR) !== ".e2e-data") {
    throw new Error(`Refusing to wipe unexpected data dir: ${E2E_DATA_DIR}`);
  }
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DATA_DIR, { recursive: true });
}
