"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, Debt, DebtInput, DebtRepaymentInput } from "@/lib/types";
import * as service from "../services/debts";

/** Debts are a separate tracker: they never change account balances. */
export async function createDebt(input: DebtInput): Promise<ActionResult<Debt>> {
  const result = await service.createDebt(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateDebt(id: string, input: DebtInput): Promise<ActionResult<Debt>> {
  const result = await service.updateDebt(id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Removes the debt and all its repayments. */
export async function deleteDebt(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteDebt(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function addDebtRepayment(debtId: string, input: DebtRepaymentInput): Promise<ActionResult<Debt>> {
  const result = await service.addDebtRepayment(debtId, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function deleteDebtRepayment(debtId: string, repaymentId: string): Promise<ActionResult<Debt>> {
  const result = await service.deleteDebtRepayment(debtId, repaymentId);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
