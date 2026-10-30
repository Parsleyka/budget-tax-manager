"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, Transfer, TransferInput } from "@/lib/types";
import * as service from "../services/transfers";

/** Accounts must differ; same currency → toAmount = fromAmount (may be omitted); cross-currency → toAmount required. */
export async function createTransfer(input: TransferInput): Promise<ActionResult<Transfer>> {
  const result = await service.createTransfer(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateTransfer(id: string, input: TransferInput): Promise<ActionResult<Transfer>> {
  const result = await service.updateTransfer(id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function deleteTransfer(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteTransfer(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
