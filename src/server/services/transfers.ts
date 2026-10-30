import "server-only";
import { randomUUID } from "node:crypto";
import { nowIso, todayKyiv } from "@/lib/dates";
import { checkNotFuture, checkTransfer, isProblem } from "@/lib/integrity";
import { TransferInputSchema } from "@/lib/schemas";
import type { ActionResult, Transfer } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { accountsRepo, transfersRepo } from "../db/repositories";
import { fail, fromProblem, fromZod, guard, isFailure, ok, parseId } from "./result";

async function build(input: unknown, existing: Transfer | null): Promise<ActionResult<Transfer>> {
  const parsed = TransferInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const t = parsed.data;
  const future = checkNotFuture(t.date, todayKyiv(), { existingDate: existing?.date });
  if (future) return fromProblem(future);
  const check = checkTransfer(t, { accounts: await accountsRepo.list() }, existing ?? undefined);
  if (isProblem(check)) return fromProblem(check);
  const now = nowIso();
  return ok({
    id: existing?.id ?? randomUUID(),
    date: t.date,
    fromAccountId: t.fromAccountId,
    toAccountId: t.toAccountId,
    fromAmount: t.fromAmount,
    toAmount: check.toAmount,
    ...(t.note ? { note: t.note } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

export function createTransfer(input: unknown): Promise<ActionResult<Transfer>> {
  return guard(() =>
    withLock(DB_WRITE_LOCK, async () => {
      const built = await build(input, null);
      if (!built.ok) return built;
      return ok(await transfersRepo.insert(built.data));
    }),
  );
}

export function updateTransfer(id: unknown, input: unknown): Promise<ActionResult<Transfer>> {
  return guard(async () => {
    const transferId = parseId(id);
    if (isFailure(transferId)) return transferId;
    return withLock(DB_WRITE_LOCK, async () => {
      const existing = await transfersRepo.get(transferId);
      if (!existing) return fail("Transfer not found");
      const built = await build(input, existing);
      if (!built.ok) return built;
      return ok(await transfersRepo.update(transferId, () => built.data));
    });
  });
}

export function deleteTransfer(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const transferId = parseId(id);
    if (isFailure(transferId)) return transferId;
    return withLock(DB_WRITE_LOCK, async () => {
      const removed = await transfersRepo.remove(transferId);
      return removed ? ok(null) : fail("Transfer not found");
    });
  });
}
