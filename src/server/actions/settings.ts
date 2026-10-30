"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, Settings, SettingsInput } from "@/lib/types";
import * as service from "../services/settings";

/** Patch `{ tax?: Partial<TaxSettings>, defaultActiveAccountId? }`; field errors are keyed "tax.<field>". */
export async function updateSettings(input: SettingsInput): Promise<ActionResult<Settings>> {
  const result = await service.updateSettings(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
