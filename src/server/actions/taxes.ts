"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { ActionResult, Expense, TaxPaymentInput } from "@/lib/types";
import * as service from "../services/expenses";

/** Record a tax payment: one UAH expense in the Taxes category per line, each with taxMeta { kind, period }. */
export async function recordTaxPayment(input: TaxPaymentInput): Promise<ActionResult<Expense[]>> {
  const result = await service.recordTaxPayment(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
