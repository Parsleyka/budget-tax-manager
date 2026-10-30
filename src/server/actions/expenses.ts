"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, Expense, ExpenseInput } from "@/lib/types";
import * as service from "../services/expenses";

/** Create a spending. Currency = account currency; non-UAH rates are resolved server-side unless rateSource = "manual". */
export async function createExpense(input: ExpenseInput): Promise<ActionResult<Expense>> {
  const result = await service.createExpense(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<ActionResult<Expense>> {
  const result = await service.updateExpense(id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function deleteExpense(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteExpense(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
