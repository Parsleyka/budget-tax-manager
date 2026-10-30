import "server-only";
import { randomUUID } from "node:crypto";
import { formatQuarter, nowIso, todayKyiv } from "@/lib/dates";
import { checkAccountUsable, checkDerivedAmount, checkExpenseRefs, checkNotFuture, checkTaxPayment, isProblem } from "@/lib/integrity";
import { convertToUah } from "@/lib/money";
import { ExpenseInputSchema, TaxPaymentInputSchema } from "@/lib/schemas";
import { TAX_KIND_LABELS, type ActionResult, type Expense } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { accountsRepo, categoriesRepo, expensesRepo } from "../db/repositories";
import type { RateOptions } from "../nbu/rates";
import { resolveEntryRate } from "./entry-rate";
import { fail, fromProblem, fromZod, guard, isFailure, ok, parseId } from "./result";

async function build(input: unknown, existing: Expense | null, opts?: RateOptions): Promise<ActionResult<Expense>> {
  const parsed = ExpenseInputSchema.safeParse(input);
  if (!parsed.success) return fromZod(parsed.error);
  const e = parsed.data;
  const future = checkNotFuture(e.date, todayKyiv(), { existingDate: existing?.date });
  if (future) return fromProblem(future);
  const acc = checkAccountUsable(e.accountId, { accounts: await accountsRepo.list() }, "accountId", existing?.accountId);
  if (isProblem(acc)) return fromProblem(acc);
  const currency = acc.account.currency;
  // Tax link: explicit value wins (null = unlink), omitted keeps the existing link.
  const taxMeta = e.taxMeta === null ? undefined : (e.taxMeta ?? existing?.taxMeta);
  if (e.taxMeta) {
    const category = (await categoriesRepo.list()).find((c) => c.id === e.categoryId);
    if (category?.systemKey !== "taxes") {
      return fail("Only spendings in the Taxes category can be linked to a tax quarter", {
        taxMeta: ["Choose the Taxes category to link this payment to a quarter"],
      });
    }
    if (currency !== "UAH") return fail("Taxes are paid from a UAH account", { accountId: ["Taxes are paid from a UAH account"] });
  }
  const rate = await resolveEntryRate(currency, e.date, e.rateSource, e.rate, opts);
  if (isFailure(rate)) return rate;
  const amountUah = convertToUah(e.amount, rate.rate);
  const tooLarge = checkDerivedAmount(amountUah, "amount", "The amount in UAH");
  if (tooLarge) return fromProblem(tooLarge);
  const now = nowIso();
  return ok({
    id: existing?.id ?? randomUUID(),
    date: e.date,
    amount: e.amount,
    currency,
    rate: rate.rate,
    ...(currency !== "UAH" ? { rateSource: rate.rateSource } : {}),
    amountUah,
    categoryId: e.categoryId,
    accountId: e.accountId,
    ...(e.note ? { note: e.note } : {}),
    // Editing keeps the tax link (so paid-vs-due stays correct) unless moved out of Taxes below.
    ...(taxMeta ? { taxMeta } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

async function refsProblem(expense: Expense, existing?: Expense) {
  const [accounts, categories] = await Promise.all([accountsRepo.list(), categoriesRepo.list()]);
  const problem = checkExpenseRefs(expense, { accounts, categories }, existing);
  if (problem) return problem;
  const account = accounts.find((a) => a.id === expense.accountId);
  if (account && account.currency !== expense.currency) {
    return { error: "Currency must match the account currency", fieldErrors: { accountId: ["Currency mismatch"] } };
  }
  return null;
}

export function createExpense(input: unknown, opts?: RateOptions): Promise<ActionResult<Expense>> {
  return guard(async () => {
    const built = await build(input, null, opts);
    if (!built.ok) return built;
    return withLock(DB_WRITE_LOCK, async () => {
      const problem = await refsProblem(built.data);
      if (problem) return fromProblem(problem);
      return ok(await expensesRepo.insert(built.data));
    });
  });
}

export function updateExpense(id: unknown, input: unknown, opts?: RateOptions): Promise<ActionResult<Expense>> {
  return guard(async () => {
    const expenseId = parseId(id);
    if (isFailure(expenseId)) return expenseId;
    const existing = await expensesRepo.get(expenseId);
    if (!existing) return fail("Spending not found");
    const built = await build(input, existing, opts);
    if (!built.ok) return built;
    let expense = built.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const problem = await refsProblem(expense, existing);
      if (problem) return fromProblem(problem);
      if (expense.taxMeta) {
        const category = (await categoriesRepo.list()).find((c) => c.id === expense.categoryId);
        // Moved out of Taxes → no longer a tax payment.
        if (category?.systemKey !== "taxes") {
          const { taxMeta: _drop, ...rest } = expense;
          void _drop;
          expense = rest;
        }
      }
      return ok(await expensesRepo.update(expenseId, () => expense));
    });
  });
}

export function deleteExpense(id: unknown): Promise<ActionResult<null>> {
  return guard(async () => {
    const expenseId = parseId(id);
    if (isFailure(expenseId)) return expenseId;
    return withLock(DB_WRITE_LOCK, async () => {
      const removed = await expensesRepo.remove(expenseId);
      return removed ? ok(null) : fail("Spending not found");
    });
  });
}

/** Creates one Taxes expense (UAH) per payment line, each with taxMeta { kind, period }. */
export function recordTaxPayment(input: unknown): Promise<ActionResult<Expense[]>> {
  return guard(async () => {
    const parsed = TaxPaymentInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const p = parsed.data;
    const future = checkNotFuture(p.date, todayKyiv());
    if (future) return fromProblem(future);
    return withLock(DB_WRITE_LOCK, async () => {
      const [accounts, categories] = await Promise.all([accountsRepo.list(), categoriesRepo.list()]);
      const check = checkTaxPayment(p.accountId, { accounts, categories });
      if (isProblem(check)) return fromProblem(check);
      const now = nowIso();
      const created: Expense[] = p.payments.map((line) => ({
        id: randomUUID(),
        date: p.date,
        amount: line.amount,
        currency: "UAH",
        rate: 1,
        amountUah: line.amount,
        categoryId: check.taxCategory.id,
        accountId: check.account.id,
        note: p.note ?? `${TAX_KIND_LABELS[line.kind]} — ${formatQuarter(p.period)}`,
        taxMeta: { kind: line.kind, period: p.period },
        createdAt: now,
        updatedAt: now,
      }));
      await expensesRepo.mutate((items) => ({ items: [...items, ...created] }));
      return ok(created);
    });
  });
}
