"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import * as service from "../services/data-transfer";

/**
 * Replace ALL data with an export file. Pass the file's text (or the parsed object). The whole
 * payload is validated first; current files are copied to data/backups/<timestamp>/ before writing.
 */
export async function importData(payload: string | object): Promise<ActionResult<service.ImportResult>> {
  const result = await service.importData(payload);
  // Also on failure: a failed import restores the previous files, but re-render from disk either way.
  revalidatePath("/", "layout");
  return result;
}
