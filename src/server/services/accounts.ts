import "server-only";
import { randomUUID } from "node:crypto";
import { formatDate, isValidDate, nowIso, todayKyiv } from "@/lib/dates";
import {
  canArchiveAccount,
  canDeleteAccount,
  checkAccountUpdate,
  checkAccountUsable,
  checkDerivedAmount,
  checkNotFuture,
  isProblem,
} from "@/lib/integrity";
import { accountBalance } from "@/lib/ledger";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import { AccountInputSchema, SetActualBalanceInputSchema } from "@/lib/schemas";
import type { Account, ActionResult, Adjustment } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { accountsRepo, adjustmentsRepo } from "../db/repositories";
import { readSnapshot } from "../db/store";
import { fail, fromProblem, fromZod, guard, isFailure, ok, parseId } from "./result";

export function createAccount(input: unknown): Promise<ActionResult<Account>> {
  return guard(async () => {
    const parsed = AccountInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const a = parsed.data;
    const now = nowIso();
    const account: Account = {
      id: randomUUID(),
      name: a.name,
      group: a.group,
      currency: a.currency,
      openingBalance: a.openingBalance,
      archived: false,
      ...(a.note ? { note: a.note } : {}),
      createdAt: now,
      updatedAt: now,
    };
    return withLock(DB_WRITE_LOCK, async () => ok(await accountsRepo.insert(account)));
  });
}

/** Edit name / group / currency (only while unreferenced) / opening balance / note. */
export function updateAccount(id: unknown, input: unknown): Promise<ActionResult<Account>> {
  return guard(async () => {
    const accountId = parseId(id);
    if (isFailure(accountId)) return accountId;
    const parsed = AccountInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const a = parsed.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const snapshot = await readSnapshot();
      const existing = snapshot.accounts.find((x) => x.id === accountId);
      if (!existing) return fail("Account not found");
      const problem = checkAccountUpdate(existing, a, snapshot);
      if (problem) return fromProblem(problem);
      return ok(
        await accountsRepo.update(accountId, (old) => {
          const { note: _oldNote, ...rest } = old;
          void _oldNote;
          return {
            ...rest,
            name: a.name,
            group: a.group,
            currency: a.currency,
            openingBalance: a.openingBalance,
            ...(a.note ? { note: a.note } : {}),
            updatedAt: nowIso(),
          };
        }),
      );
    });
  });
}

export function archiveAccount(id: unknown, archived: unknown = true): Promise<ActionResult<Account>> {
  return guard(async () => {
    const accountId = parseId(id);
    if (isFailure(accountId)) return accountId;
    if (typeof archived !== "boolean") return fail("Invalid archived flag");
    return withLock(DB_WRITE_LOCK, async () => {
      if (archived) {
        const problem = canArchiveAccount(accountId, await readSnapshot());
        if (problem) return fromProblem(problem);
      }
      return ok(await accountsRepo.update(accountId, (acc) => ({ ...acc, archived, updatedAt: nowIso() })));
    });
  });
}

export function deleteAccount(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const accountId = parseId(id);
    if (isFailure(accountId)) return accountId;
    return withLock(DB_WRITE_LOCK, async () => {
      const problem = canDeleteAccount(accountId, await readSnapshot());
      if (problem) return fromProblem(problem);
      await accountsRepo.remove(accountId);
      return ok(null);
    });
  });
}

/**
 * "Update balance": the user enters what the account held ON `date` (today by default, or e.g. a
 * statement date); an Adjustment with delta = newBalance − balance as of that date (movements dated
 * ≤ date) is stored on that date. Movements after the date keep counting on top of it.
 */
export function setActualBalance(input: unknown): Promise<ActionResult<Adjustment>> {
  return guard(async () => {
    const parsed = SetActualBalanceInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const p = parsed.data;
    const future = checkNotFuture(p.date, todayKyiv());
    if (future) return fromProblem(future);
    return withLock(DB_WRITE_LOCK, async () => {
      const snapshot = await readSnapshot();
      const acc = checkAccountUsable(p.accountId, snapshot, "accountId");
      if (isProblem(acc)) return fromProblem(acc);
      // A value update (Investments page) is absolute: a correction dated on/before it would have no effect.
      const later = snapshot.valuations
        .filter((v) => v.accountId === p.accountId && v.date >= p.date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      if (later) {
        const msg = `This account's value was set on ${formatDate(later.date)} on the Investments page — update it there, or pick a later date`;
        return fail(msg, { date: [msg] });
      }
      const current = accountBalance(p.accountId, snapshot, { asOf: p.date });
      const delta = fromMinor(toMinor(p.newBalance) - toMinor(current));
      if (delta === 0) {
        const msg = `The balance on ${formatDate(p.date)} is already ${formatMoney(current, acc.account.currency)}`;
        return fail(msg, { newBalance: [msg] });
      }
      const tooLarge = checkDerivedAmount(delta, "newBalance", "The change from the current balance");
      if (tooLarge) return fromProblem(tooLarge);
      const adjustment: Adjustment = {
        id: randomUUID(),
        date: p.date,
        accountId: p.accountId,
        delta,
        ...(p.note ? { note: p.note } : {}),
        createdAt: nowIso(),
      };
      return ok(await adjustmentsRepo.insert(adjustment));
    });
  });
}

export function deleteAdjustment(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const adjustmentId = parseId(id);
    if (isFailure(adjustmentId)) return adjustmentId;
    return withLock(DB_WRITE_LOCK, async () => {
      const removed = await adjustmentsRepo.remove(adjustmentId);
      return removed ? ok(null) : fail("Balance update not found");
    });
  });
}

/** Balance of an account on `date` (movements dated ≤ date), for the "Update balance" preview. */
export function balanceOn(accountId: unknown, date: unknown): Promise<ActionResult<number>> {
  return guard(async () => {
    const id = parseId(accountId);
    if (isFailure(id)) return id;
    if (!isValidDate(date)) return fail("Invalid date", { date: ["Enter a valid date (YYYY-MM-DD)"] });
    const snapshot = await readSnapshot();
    if (!snapshot.accounts.some((a) => a.id === id)) return fail("Account not found");
    return ok(accountBalance(id, snapshot, { asOf: date }));
  });
}
