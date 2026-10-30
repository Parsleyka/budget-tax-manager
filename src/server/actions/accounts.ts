"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import type { Account, AccountInput, ActionResult, Adjustment, SetActualBalanceInput } from "@/lib/types";
import * as service from "../services/accounts";

export async function createAccount(input: AccountInput): Promise<ActionResult<Account>> {
  const result = await service.createAccount(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Currency can only change while the account has no records; the default account must stay Active. */
export async function updateAccount(id: string, input: AccountInput): Promise<ActionResult<Account>> {
  const result = await service.updateAccount(id, input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Archive (default) or restore. The default (main) account cannot be archived. */
export async function archiveAccount(id: string, archived = true): Promise<ActionResult<Account>> {
  const result = await service.archiveAccount(id, archived);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Only when nothing references the account and it is not the default account. */
export async function deleteAccount(id: string): Promise<ActionResult<null>> {
  const result = await service.deleteAccount(id);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** "Update balance": stores an Adjustment with delta = newBalance − current balance. */
export async function setActualBalance(input: SetActualBalanceInput): Promise<ActionResult<Adjustment>> {
  const result = await service.setActualBalance(input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Read-only: an account's balance on `date` (the "Update balance" dialog's preview). Revalidates nothing. */
export async function getBalanceOn(accountId: string, date: string): Promise<ActionResult<number>> {
  return service.balanceOn(accountId, date);
}
