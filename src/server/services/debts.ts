import "server-only";
import { randomUUID } from "node:crypto";
import { nowIso, todayKyiv } from "@/lib/dates";
import { checkDebtUpdate, checkNotFuture, checkRepayment, checkRepaymentAccount, isProblem } from "@/lib/integrity";
import { DebtInputSchema, DebtRepaymentInputSchema } from "@/lib/schemas";
import type { ActionResult, Debt, DebtRepayment } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { accountsRepo, debtsRepo } from "../db/repositories";
import { fail, fromProblem, fromZod, guard, isFailure, ok, parseId } from "./result";

/** Lent / borrowed money — a separate tracker that never touches account balances (src/lib/debts.ts). */
export function createDebt(input: unknown): Promise<ActionResult<Debt>> {
  return guard(async () => {
    const parsed = DebtInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const d = parsed.data;
    const future = checkNotFuture(d.date, todayKyiv());
    if (future) return fromProblem(future);
    return withLock(DB_WRITE_LOCK, async () => {
      const now = nowIso();
      const debt: Debt = {
        id: randomUUID(),
        direction: d.direction,
        counterparty: d.counterparty,
        date: d.date,
        amount: d.amount,
        currency: d.currency,
        ...(d.dueDate ? { dueDate: d.dueDate } : {}),
        ...(d.note ? { note: d.note } : {}),
        repayments: [],
        createdAt: now,
        updatedAt: now,
      };
      return ok(await debtsRepo.insert(debt));
    });
  });
}

/** Edit everything but the repayments. */
export function updateDebt(id: unknown, input: unknown): Promise<ActionResult<Debt>> {
  return guard(async () => {
    const debtId = parseId(id);
    if (isFailure(debtId)) return debtId;
    const parsed = DebtInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const d = parsed.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const existing = await debtsRepo.get(debtId);
      if (!existing) return fail("Debt not found");
      const future = checkNotFuture(d.date, todayKyiv(), { existingDate: existing.date });
      if (future) return fromProblem(future);
      const update = checkDebtUpdate(existing, d);
      if (update) return fromProblem(update);
      return ok(
        await debtsRepo.update(debtId, (old) => ({
          id: old.id,
          direction: d.direction,
          counterparty: d.counterparty,
          date: d.date,
          amount: d.amount,
          currency: d.currency,
          ...(d.dueDate ? { dueDate: d.dueDate } : {}),
          ...(d.note ? { note: d.note } : {}),
          repayments: old.repayments,
          createdAt: old.createdAt,
          updatedAt: nowIso(),
        })),
      );
    });
  });
}

/** Deletes the debt with all its repayments. */
export function deleteDebt(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const debtId = parseId(id);
    if (isFailure(debtId)) return debtId;
    return withLock(DB_WRITE_LOCK, async () => {
      const removed = await debtsRepo.remove(debtId);
      return removed ? ok(null) : fail("Debt not found");
    });
  });
}

/**
 * Record a (partial) repayment: at most the outstanding amount, not before the debt, not in the future.
 * With `accountId` the money arrived in / left that account (its balance changes).
 */
export function addDebtRepayment(debtId: unknown, input: unknown): Promise<ActionResult<Debt>> {
  return guard(async () => {
    const id = parseId(debtId);
    if (isFailure(id)) return id;
    const parsed = DebtRepaymentInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const r = parsed.data;
    const future = checkNotFuture(r.date, todayKyiv());
    if (future) return fromProblem(future);
    return withLock(DB_WRITE_LOCK, async () => {
      const debt = await debtsRepo.get(id);
      if (!debt) return fail("Debt not found");
      const problem = checkRepayment(debt, r);
      if (problem) return fromProblem(problem);
      const linked = checkRepaymentAccount(r, debt.currency, { accounts: await accountsRepo.list() });
      if (isProblem(linked)) return fromProblem(linked);
      const repayment: DebtRepayment = {
        id: randomUUID(),
        date: r.date,
        amount: r.amount,
        ...(linked.account ? { accountId: linked.account.id } : {}),
        ...(linked.accountAmount !== undefined ? { accountAmount: linked.accountAmount } : {}),
        ...(r.note ? { note: r.note } : {}),
        createdAt: nowIso(),
      };
      return ok(
        await debtsRepo.update(id, (old) => ({ ...old, repayments: [...old.repayments, repayment], updatedAt: nowIso() })),
      );
    });
  });
}

export function deleteDebtRepayment(debtId: unknown, repaymentId: unknown): Promise<ActionResult<Debt>> {
  return guard(async () => {
    const id = parseId(debtId);
    if (isFailure(id)) return id;
    const rid = parseId(repaymentId);
    if (isFailure(rid)) return rid;
    return withLock(DB_WRITE_LOCK, async () => {
      const debt = await debtsRepo.get(id);
      if (!debt) return fail("Debt not found");
      if (!debt.repayments.some((r) => r.id === rid)) return fail("Repayment not found");
      return ok(
        await debtsRepo.update(id, (old) => ({ ...old, repayments: old.repayments.filter((r) => r.id !== rid), updatedAt: nowIso() })),
      );
    });
  });
}
