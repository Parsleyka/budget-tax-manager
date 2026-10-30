"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, InvestmentFlow, InvestmentFlowInput, Valuation, ValuationInput } from "@/lib/types";
import * as service from "../services/investments";

/** Deposit / withdrawal of an investment account; with `linkedAccountId` it is stored as a Transfer. */
export async function addInvestmentFlow(input: InvestmentFlowInput): Promise<ActionResult<service.InvestmentFlowResult>> {
  const result = await service.addInvestmentFlow(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function updateInvestmentFlow(id: string, input: InvestmentFlowInput): Promise<ActionResult<InvestmentFlow>> {
  const result = await service.updateInvestmentFlow(id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function deleteInvestmentFlow(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteInvestmentFlow(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** "Update value" (absolute market value on a date; same-day updates replace each other). */
export async function setValuation(input: ValuationInput): Promise<ActionResult<Valuation>> {
  const result = await service.setValuation(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function deleteValuation(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteValuation(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
