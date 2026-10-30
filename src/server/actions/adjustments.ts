"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import * as service from "../services/accounts";

export async function deleteAdjustment(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteAdjustment(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
