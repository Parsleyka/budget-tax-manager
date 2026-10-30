import "server-only";
import { randomUUID } from "node:crypto";
import { nowIso, todayKyiv } from "@/lib/dates";
import { checkDerivedAmount, checkIncomeRefs, checkNotFuture } from "@/lib/integrity";
import { convertToUah } from "@/lib/money";
import { IncomeInputSchema } from "@/lib/schemas";
import type { ActionResult, Income } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { accountsRepo, incomesRepo } from "../db/repositories";
import type { RateOptions } from "../nbu/rates";
import { resolveEntryRate } from "./entry-rate";
import { fail, fromProblem, fromZod, guard, isFailure, ok, parseId } from "./result";

async function build(input: unknown, existing: Income | null, opts?: RateOptions): Promise<ActionResult<Income>> {
  const parsed = IncomeInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const i = parsed.data;
  const future = checkNotFuture(i.date, todayKyiv(), { existingDate: existing?.date });
  if (future) return fromProblem(future);
  // Cheap reference check first so we never call NBU for an input that will be rejected anyway
  // (re-checked under the write lock before saving).
  const pre = checkIncomeRefs(i, { accounts: await accountsRepo.list() }, existing ?? undefined);
  if (pre) return fromProblem(pre);
  const rate = await resolveEntryRate(i.currency, i.date, i.rateSource, i.rate, opts);
  if (isFailure(rate)) return rate;
  const amountUah = convertToUah(i.amount, rate.rate);
  const tooLarge = checkDerivedAmount(amountUah, "amount", "The amount in UAH");
  if (tooLarge) return fromProblem(tooLarge);
  const now = nowIso();
  const fee = i.kind === "freelance" && i.fee ? i.fee : undefined;
  const income: Income = {
    id: existing?.id ?? randomUUID(),
    kind: i.kind,
    date: i.date,
    amount: i.amount,
    currency: i.currency,
    rate: rate.rate,
    rateSource: rate.rateSource,
    amountUah,
    ...(fee ? { fee } : {}),
    accountId: i.accountId,
    ...(i.counterparty ? { counterparty: i.counterparty } : {}),
    ...(i.note ? { note: i.note } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return ok(income);
}

export function createIncome(input: unknown, opts?: RateOptions): Promise<ActionResult<Income>> {
  return guard(async () => {
    const built = await build(input, null, opts);
    if (!built.ok) return built;
    const income = built.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const problem = checkIncomeRefs(income, { accounts: await accountsRepo.list() });
      if (problem) return fromProblem(problem);
      return ok(await incomesRepo.insert(income));
    });
  });
}

export function updateIncome(id: unknown, input: unknown, opts?: RateOptions): Promise<ActionResult<Income>> {
  return guard(async () => {
    const incomeId = parseId(id);
    if (isFailure(incomeId)) return incomeId;
    const existing = await incomesRepo.get(incomeId);
    if (!existing) return fail("Income not found");
    const built = await build(input, existing, opts);
    if (!built.ok) return built;
    const income = built.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const problem = checkIncomeRefs(income, { accounts: await accountsRepo.list() }, existing);
      if (problem) return fromProblem(problem);
      return ok(await incomesRepo.update(incomeId, () => income));
    });
  });
}

export function deleteIncome(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const incomeId = parseId(id);
    if (isFailure(incomeId)) return incomeId;
    return withLock(DB_WRITE_LOCK, async () => {
      const removed = await incomesRepo.remove(incomeId);
      return removed ? ok(null) : fail("Income not found");
    });
  });
}
