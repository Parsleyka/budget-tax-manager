import "server-only";
import { randomUUID } from "node:crypto";
import { nowIso, todayKyiv } from "@/lib/dates";
import { checkAccountUsable, checkNotFuture, isProblem, type IntegrityProblem } from "@/lib/integrity";
import { isInvestmentAccount } from "@/lib/investments";
import { InvestmentFlowInputSchema, ValuationInputSchema } from "@/lib/schemas";
import type { Account, ActionResult, InvestmentFlow, Transfer, Valuation } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { accountsRepo, investmentFlowsRepo, transfersRepo, valuationsRepo } from "../db/repositories";
import { fail, fromProblem, fromZod, guard, isFailure, ok, parseId } from "./result";

/**
 * Investments: deposits / withdrawals and manual value updates of investment accounts (group "ibkr").
 * A deposit / withdrawal linked to one of your accounts is stored as a Transfer (money really moves);
 * otherwise as an InvestmentFlow (outside money). Value updates are absolute Valuations.
 */

const problem = (error: string, field: string, message = error): IntegrityProblem => ({ error, fieldErrors: { [field]: [message] } });

function investmentAccount(accountId: string, accounts: readonly Account[], keepId?: string): { account: Account } | IntegrityProblem {
  const r = checkAccountUsable(accountId, { accounts: [...accounts] }, "accountId", keepId);
  if (isProblem(r)) return r;
  if (!isInvestmentAccount(r.account)) return problem("Choose an investment or deposit account", "accountId");
  return r;
}

export type InvestmentFlowResult = { stored: "flow"; flow: InvestmentFlow } | { stored: "transfer"; transfer: Transfer };

/** Add a deposit / withdrawal. With `linkedAccountId` it becomes a Transfer between your accounts. */
export function addInvestmentFlow(input: unknown): Promise<ActionResult<InvestmentFlowResult>> {
  return guard(async () => {
    const parsed = InvestmentFlowInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const f = parsed.data;
    const future = checkNotFuture(f.date, todayKyiv());
    if (future) return fromProblem(future);
    return withLock(DB_WRITE_LOCK, async () => {
      const accounts = await accountsRepo.list();
      const inv = investmentAccount(f.accountId, accounts);
      if (isProblem(inv)) return fromProblem(inv);
      const now = nowIso();

      if (!f.linkedAccountId) {
        const flow: InvestmentFlow = {
          id: randomUUID(),
          accountId: f.accountId,
          date: f.date,
          kind: f.kind,
          amount: f.amount,
          ...(f.note ? { note: f.note } : {}),
          createdAt: now,
          updatedAt: now,
        };
        return ok<InvestmentFlowResult>({ stored: "flow", flow: await investmentFlowsRepo.insert(flow) });
      }

      if (f.linkedAccountId === f.accountId) return fromProblem(problem("Choose a different account", "linkedAccountId"));
      const linked = checkAccountUsable(f.linkedAccountId, { accounts }, "linkedAccountId");
      if (isProblem(linked)) return fromProblem(linked);
      const same = linked.account.currency === inv.account.currency;
      if (!same && !f.linkedAmount) {
        const verb = f.kind === "deposit" ? "left" : "arrived in";
        return fromProblem(problem(`Enter the amount that ${verb} ${linked.account.name} (${linked.account.currency})`, "linkedAmount"));
      }
      const linkedAmount = same ? f.amount : (f.linkedAmount as number);
      const deposit = f.kind === "deposit";
      const transfer: Transfer = {
        id: randomUUID(),
        date: f.date,
        fromAccountId: deposit ? linked.account.id : inv.account.id,
        toAccountId: deposit ? inv.account.id : linked.account.id,
        fromAmount: deposit ? linkedAmount : f.amount,
        toAmount: deposit ? f.amount : linkedAmount,
        ...(f.note ? { note: f.note } : {}),
        createdAt: now,
        updatedAt: now,
      };
      return ok<InvestmentFlowResult>({ stored: "transfer", transfer: await transfersRepo.insert(transfer) });
    });
  });
}

/** Edit a deposit / withdrawal from outside (InvestmentFlow). Linked ones are Transfers — edit those instead. */
export function updateInvestmentFlow(id: unknown, input: unknown): Promise<ActionResult<InvestmentFlow>> {
  return guard(async () => {
    const flowId = parseId(id);
    if (isFailure(flowId)) return flowId;
    const parsed = InvestmentFlowInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const f = parsed.data;
    if (f.linkedAccountId) {
      return fromProblem(problem("To move money from one of your accounts, delete this one and add a new deposit from that account", "linkedAccountId"));
    }
    return withLock(DB_WRITE_LOCK, async () => {
      const existing = await investmentFlowsRepo.get(flowId);
      if (!existing) return fail("Deposit / withdrawal not found");
      const future = checkNotFuture(f.date, todayKyiv(), { existingDate: existing.date });
      if (future) return fromProblem(future);
      const inv = investmentAccount(f.accountId, await accountsRepo.list(), existing.accountId);
      if (isProblem(inv)) return fromProblem(inv);
      return ok(
        await investmentFlowsRepo.update(flowId, (old) => ({
          id: old.id,
          accountId: f.accountId,
          date: f.date,
          kind: f.kind,
          amount: f.amount,
          ...(f.note ? { note: f.note } : {}),
          createdAt: old.createdAt,
          updatedAt: nowIso(),
        })),
      );
    });
  });
}

export function deleteInvestmentFlow(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const flowId = parseId(id);
    if (isFailure(flowId)) return flowId;
    return withLock(DB_WRITE_LOCK, async () => {
      const removed = await investmentFlowsRepo.remove(flowId);
      return removed ? ok(null) : fail("Deposit / withdrawal not found");
    });
  });
}

/**
 * "Update value": the account's market value on `date` (absolute). A second update on the same date
 * replaces the first, so there is one value per day.
 */
export function setValuation(input: unknown): Promise<ActionResult<Valuation>> {
  return guard(async () => {
    const parsed = ValuationInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const v = parsed.data;
    const future = checkNotFuture(v.date, todayKyiv());
    if (future) return fromProblem(future);
    return withLock(DB_WRITE_LOCK, async () => {
      const inv = investmentAccount(v.accountId, await accountsRepo.list());
      if (isProblem(inv)) return fromProblem(inv);
      const sameDay = (await valuationsRepo.list()).find((x) => x.accountId === v.accountId && x.date === v.date);
      if (sameDay) {
        return ok(
          await valuationsRepo.update(sameDay.id, (old) => ({
            id: old.id,
            accountId: old.accountId,
            date: old.date,
            value: v.value,
            ...(v.note ? { note: v.note } : {}),
            createdAt: old.createdAt,
          })),
        );
      }
      const valuation: Valuation = {
        id: randomUUID(),
        accountId: v.accountId,
        date: v.date,
        value: v.value,
        ...(v.note ? { note: v.note } : {}),
        createdAt: nowIso(),
      };
      return ok(await valuationsRepo.insert(valuation));
    });
  });
}

export function deleteValuation(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const valuationId = parseId(id);
    if (isFailure(valuationId)) return valuationId;
    return withLock(DB_WRITE_LOCK, async () => {
      const removed = await valuationsRepo.remove(valuationId);
      return removed ? ok(null) : fail("Value update not found");
    });
  });
}
