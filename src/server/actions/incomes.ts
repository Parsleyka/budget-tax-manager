"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, Income, IncomeInput } from "@/lib/types";
import * as service from "../services/incomes";

/** Create a salary or freelance income. Non-UAH: the NBU rate for `date` is resolved server-side unless rateSource = "manual". */
export async function createIncome(input: IncomeInput): Promise<ActionResult<Income>> {
  const result = await service.createIncome(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateIncome(id: string, input: IncomeInput): Promise<ActionResult<Income>> {
  const result = await service.updateIncome(id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function deleteIncome(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteIncome(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
