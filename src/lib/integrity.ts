/**
 * Referential-integrity rules (SPEC §3), as pure functions over a data snapshot so they can be
 * unit-tested without Next and reused by import validation. Each check returns `null` when OK,
 * or a problem `{ error, fieldErrors? }` shaped like a failed ActionResult.
 */
import { outstandingMinor } from "./debts";
import { isTrackedGroup } from "./investments";
import { accountUsage } from "./ledger";
import { formatMoney, fromMinor, toMinor } from "./money";
import { MAX_AMOUNT } from "./schemas";
import type { Account, Category, Currency, DataSnapshot, Debt, FieldErrors, Income } from "./types";

export interface IntegrityProblem {
  error: string;
  fieldErrors?: FieldErrors;
}

const problem = (error: string, field?: string, fieldMessage?: string): IntegrityProblem =>
  field ? { error, fieldErrors: { [field]: [fieldMessage ?? error] } } : { error };

type Snap = Pick<DataSnapshot, "accounts">;

/**
 * An account usable for a new/edited record: must exist and not be archived — unless it is the
 * record's existing account (`keepId`), so editing an old record on an archived account works.
 */
export function checkAccountUsable(
  accountId: string,
  snapshot: Snap,
  field: string,
  keepId?: string,
): { account: Account } | IntegrityProblem {
  const account = snapshot.accounts.find((a) => a.id === accountId);
  if (!account) return problem("Account not found", field, "Choose an account");
  if (account.archived && account.id !== keepId) return problem("Account is archived", field, "This account is archived");
  return { account };
}

export function isProblem(x: unknown): x is IntegrityProblem {
  return typeof x === "object" && x !== null && "error" in x;
}

export function checkCategoryUsable(
  categoryId: string,
  snapshot: Pick<DataSnapshot, "categories">,
  field = "categoryId",
  keepId?: string,
): { category: Category } | IntegrityProblem {
  const category = snapshot.categories.find((c) => c.id === categoryId);
  if (!category) return problem("Category not found", field, "Choose a category");
  if (category.archived && category.id !== keepId) return problem("Category is archived", field, "This category is archived");
  return { category };
}

/** Income: account usable, currency = account currency, salary only into UAH accounts. */
export function checkIncomeRefs(
  input: Pick<Income, "kind" | "currency" | "accountId">,
  snapshot: Snap,
  existing?: Pick<Income, "accountId">,
): IntegrityProblem | null {
  const r = checkAccountUsable(input.accountId, snapshot, "accountId", existing?.accountId);
  if (isProblem(r)) return r;
  if (r.account.currency !== input.currency) {
    return problem(
      `Currency must match the account currency (${r.account.currency})`,
      "currency",
      `“${r.account.name}” is a ${r.account.currency} account`,
    );
  }
  if (input.kind === "salary" && r.account.currency !== "UAH") {
    return problem("Salary must go to a UAH account", "accountId");
  }
  return null;
}

/** Expense: account + category usable. */
export function checkExpenseRefs(
  input: { accountId: string; categoryId: string },
  snapshot: Pick<DataSnapshot, "accounts" | "categories">,
  existing?: { accountId: string; categoryId: string },
): IntegrityProblem | null {
  const a = checkAccountUsable(input.accountId, snapshot, "accountId", existing?.accountId);
  if (isProblem(a)) return a;
  const c = checkCategoryUsable(input.categoryId, snapshot, "categoryId", existing?.categoryId);
  if (isProblem(c)) return c;
  return null;
}

/**
 * Transfer: different usable accounts; same-currency transfers must have toAmount = fromAmount
 * (a missing toAmount is filled in); cross-currency transfers need toAmount.
 * Returns the resolved toAmount on success.
 */
export function checkTransfer(
  input: { fromAccountId: string; toAccountId: string; fromAmount: number; toAmount?: number | null },
  snapshot: Snap,
  existing?: { fromAccountId: string; toAccountId: string },
): { toAmount: number; from: Account; to: Account } | IntegrityProblem {
  if (input.fromAccountId === input.toAccountId) return problem("Choose two different accounts", "toAccountId");
  const from = checkAccountUsable(input.fromAccountId, snapshot, "fromAccountId", existing?.fromAccountId);
  if (isProblem(from)) return from;
  const to = checkAccountUsable(input.toAccountId, snapshot, "toAccountId", existing?.toAccountId);
  if (isProblem(to)) return to;
  if (from.account.currency === to.account.currency) {
    if (input.toAmount !== undefined && input.toAmount !== null && input.toAmount !== input.fromAmount) {
      return problem("Same-currency transfers must have equal amounts", "toAmount");
    }
    return { toAmount: input.fromAmount, from: from.account, to: to.account };
  }
  if (input.toAmount === undefined || input.toAmount === null) {
    return problem(`Enter the amount received in ${to.account.currency}`, "toAmount");
  }
  return { toAmount: input.toAmount, from: from.account, to: to.account };
}

/** Accounts can only be deleted when nothing references them and they are not the default account. */
export function canDeleteAccount(accountId: string, snapshot: DataSnapshot): IntegrityProblem | null {
  const account = snapshot.accounts.find((a) => a.id === accountId);
  if (!account) return problem("Account not found");
  if (snapshot.settings.defaultActiveAccountId === accountId) {
    return problem("This is the default (main) account. Choose another default account in Settings first.");
  }
  const usage = accountUsage(accountId, snapshot);
  if (usage.total > 0) {
    return problem(
      `“${account.name}” is used by ${usage.total} record(s) (${usage.incomes} incomes, ${usage.expenses} spendings, ` +
        `${usage.transfers} transfers, ${usage.adjustments} balance updates, ${usage.investments} investment records, ` +
        `${usage.debts} debt repayments). Archive it instead.`,
    );
  }
  return null;
}

/** Editing a debt: the new amount must cover what was already repaid, and repayments can't predate it. */
export function checkDebtUpdate(existing: Debt, next: { amount: number; date: string; currency: Currency }): IntegrityProblem | null {
  const repaid = existing.repayments.reduce((s, r) => s + toMinor(r.amount), 0);
  if (toMinor(next.amount) < repaid) {
    return problem(
      `${formatMoney(fromMinor(repaid), existing.currency)} has already been repaid — the amount can't be less than that`,
      "amount",
    );
  }
  if (existing.repayments.length > 0 && next.currency !== existing.currency) {
    return problem("The currency can't be changed once repayments are recorded", "currency");
  }
  const earliest = existing.repayments.reduce<string | null>((m, r) => (m === null || r.date < m ? r.date : m), null);
  if (earliest !== null && next.date > earliest) {
    return problem("The debt date can't be after its first repayment", "date");
  }
  return null;
}

/**
 * The account a repayment arrives in / is paid from: optional; when set it must be usable, and an
 * account in another currency needs `accountAmount` (what arrived / left, in the account's currency).
 */
export function checkRepaymentAccount(
  input: { accountId?: string | null; accountAmount?: number | null },
  debtCurrency: Currency,
  snapshot: Snap,
): { account: Account | null; accountAmount: number | undefined } | IntegrityProblem {
  if (!input.accountId) return { account: null, accountAmount: undefined };
  const r = checkAccountUsable(input.accountId, snapshot, "accountId");
  if (isProblem(r)) return r;
  if (r.account.currency === debtCurrency) return { account: r.account, accountAmount: undefined };
  if (!input.accountAmount) {
    return problem(`Enter the amount in ${r.account.currency} — what arrived in / left “${r.account.name}”`, "accountAmount");
  }
  return { account: r.account, accountAmount: input.accountAmount };
}

/** A new repayment: not before the debt, and at most what is still outstanding. */
export function checkRepayment(debt: Debt, input: { amount: number; date: string }): IntegrityProblem | null {
  if (input.date < debt.date) return problem("A repayment can't be dated before the debt", "date");
  const outstanding = outstandingMinor(debt);
  if (outstanding === 0) return problem("This debt is already fully repaid");
  if (toMinor(input.amount) > outstanding) {
    return problem(`Only ${formatMoney(fromMinor(outstanding), debt.currency)} is outstanding`, "amount");
  }
  return null;
}

export function canArchiveAccount(accountId: string, snapshot: DataSnapshot): IntegrityProblem | null {
  const account = snapshot.accounts.find((a) => a.id === accountId);
  if (!account) return problem("Account not found");
  if (snapshot.settings.defaultActiveAccountId === accountId) {
    return problem("The default (main) account cannot be archived. Choose another default account in Settings first.");
  }
  return null;
}

/** Account edits: currency/group changes must keep existing records consistent. */
export function checkAccountUpdate(
  existing: Account,
  next: Pick<Account, "group" | "currency">,
  snapshot: DataSnapshot,
): IntegrityProblem | null {
  if (next.group === "active" && next.currency !== "UAH") {
    return problem("Accounts in the Active group must be in UAH", "currency");
  }
  const usage = accountUsage(existing.id, snapshot);
  if (existing.currency !== next.currency && usage.total > 0) {
    return problem("Currency cannot be changed for an account that already has records", "currency");
  }
  if (isTrackedGroup(existing.group) && !isTrackedGroup(next.group) && usage.investments > 0) {
    return problem("This account has deposits or value updates — keep it in Investments or Deposits", "group");
  }
  if (snapshot.settings.defaultActiveAccountId === existing.id && next.group !== "active") {
    return problem("The default (main) account must stay in the Active group", "group");
  }
  return null;
}

export function canDeleteCategory(categoryId: string, snapshot: Pick<DataSnapshot, "categories" | "expenses">): IntegrityProblem | null {
  const category = snapshot.categories.find((c) => c.id === categoryId);
  if (!category) return problem("Category not found");
  if (category.systemKey === "taxes") return problem("The Taxes category is required for tax payments and cannot be deleted.");
  const count = snapshot.expenses.filter((e) => e.categoryId === categoryId).length;
  if (count > 0) return problem(`“${category.name}” is used by ${count} spending(s). Archive it instead.`);
  return null;
}

export function canArchiveCategory(categoryId: string, snapshot: Pick<DataSnapshot, "categories">): IntegrityProblem | null {
  const category = snapshot.categories.find((c) => c.id === categoryId);
  if (!category) return problem("Category not found");
  if (category.systemKey === "taxes") return problem("The Taxes category cannot be archived.");
  return null;
}

/** Category names are unique (case-insensitive, trimmed). */
export function checkCategoryName(
  name: string,
  categories: readonly Category[],
  exceptId?: string,
): IntegrityProblem | null {
  const n = name.trim().toLocaleLowerCase("uk-UA");
  const dup = categories.find((c) => c.id !== exceptId && c.name.trim().toLocaleLowerCase("uk-UA") === n);
  return dup ? problem("A category with this name already exists", "name") : null;
}

/** Tax payments: a usable UAH account and an existing Taxes category. */
export function checkTaxPayment(
  accountId: string,
  snapshot: Pick<DataSnapshot, "accounts" | "categories">,
): { account: Account; taxCategory: Category } | IntegrityProblem {
  const r = checkAccountUsable(accountId, snapshot, "accountId");
  if (isProblem(r)) return r;
  if (r.account.currency !== "UAH") return problem("Taxes are paid from a UAH account", "accountId");
  const taxCategory = snapshot.categories.find((c) => c.systemKey === "taxes");
  if (!taxCategory) return problem("The Taxes category is missing");
  return { account: r.account, taxCategory };
}

/** The default active account must be an existing, non-archived, UAH account in group "active". */
export function checkDefaultActiveAccount(accountId: string, accounts: readonly Account[]): IntegrityProblem | null {
  const a = accounts.find((x) => x.id === accountId);
  if (!a) return problem("Account not found", "defaultActiveAccountId");
  if (a.group !== "active" || a.currency !== "UAH") {
    return problem("The main account must be a UAH account in the Active group", "defaultActiveAccountId");
  }
  if (a.archived) return problem("The main account cannot be archived", "defaultActiveAccountId");
  return null;
}

/**
 * Whole-snapshot integrity (used by importData): unique ids, every reference resolves,
 * currencies match accounts, the Taxes category exists, and the default account is valid.
 * Returns a list of human-readable problems (empty = OK).
 */
export function checkSnapshotIntegrity(s: DataSnapshot): string[] {
  const out: string[] = [];
  const dupes = (name: string, items: readonly { id: string }[]) => {
    const seen = new Set<string>();
    for (const i of items) {
      if (seen.has(i.id)) out.push(`${name}: duplicate id ${i.id}`);
      seen.add(i.id);
    }
  };
  dupes("accounts", s.accounts);
  dupes("incomes", s.incomes);
  dupes("expenses", s.expenses);
  dupes("categories", s.categories);
  dupes("transfers", s.transfers);
  dupes("adjustments", s.adjustments);

  const accounts = new Map(s.accounts.map((a) => [a.id, a]));
  const categories = new Set(s.categories.map((c) => c.id));
  for (const i of s.incomes) {
    const a = accounts.get(i.accountId);
    if (!a) out.push(`income ${i.id}: unknown account ${i.accountId}`);
    else if (a.currency !== i.currency) out.push(`income ${i.id}: currency ${i.currency} ≠ account currency ${a.currency}`);
  }
  for (const e of s.expenses) {
    const a = accounts.get(e.accountId);
    if (!a) out.push(`expense ${e.id}: unknown account ${e.accountId}`);
    else if (a.currency !== e.currency) out.push(`expense ${e.id}: currency ${e.currency} ≠ account currency ${a.currency}`);
    if (!categories.has(e.categoryId)) out.push(`expense ${e.id}: unknown category ${e.categoryId}`);
  }
  for (const t of s.transfers) {
    const from = accounts.get(t.fromAccountId);
    const to = accounts.get(t.toAccountId);
    if (!from) out.push(`transfer ${t.id}: unknown account ${t.fromAccountId}`);
    if (!to) out.push(`transfer ${t.id}: unknown account ${t.toAccountId}`);
    if (from && to && from.currency === to.currency && t.fromAmount !== t.toAmount) {
      out.push(`transfer ${t.id}: same-currency amounts differ`);
    }
  }
  for (const a of s.adjustments) if (!accounts.has(a.accountId)) out.push(`adjustment ${a.id}: unknown account ${a.accountId}`);
  dupes("debts", s.debts);
  dupes("debt repayments", s.debts.flatMap((d) => d.repayments));
  for (const d of s.debts) {
    for (const r of d.repayments) {
      if (r.accountId && !accounts.has(r.accountId)) out.push(`debt ${d.id} repayment ${r.id}: unknown account ${r.accountId}`);
    }
  }
  dupes("investment flows", s.investmentFlows);
  dupes("valuations", s.valuations);
  for (const f of s.investmentFlows) if (!accounts.has(f.accountId)) out.push(`investment flow ${f.id}: unknown account ${f.accountId}`);
  for (const v of s.valuations) if (!accounts.has(v.accountId)) out.push(`valuation ${v.id}: unknown account ${v.accountId}`);
  const taxes = s.categories.filter((c) => c.systemKey === "taxes");
  if (taxes.length !== 1) out.push(`categories: expected exactly one Taxes category (found ${taxes.length})`);
  const def = checkDefaultActiveAccount(s.settings.defaultActiveAccountId, s.accounts);
  if (def) out.push(`settings.defaultActiveAccountId: ${def.error}`);
  return out;
}

// ------------------------------------------------------------------ dates & derived amounts

/**
 * Records are things that already happened: a date after `today` (Kyiv) is refused, so balances,
 * "This month" / "This year" lists and the tax pages always agree. Editing a record that already
 * has a future date (older data) may keep that date.
 */
export function checkNotFuture(
  date: string,
  today: string,
  options: { field?: string; existingDate?: string } = {},
): IntegrityProblem | null {
  if (date <= today || date === options.existingDate) return null;
  const msg = "The date cannot be in the future — pick today or an earlier day";
  return { error: msg, fieldErrors: { [options.field ?? "date"]: [msg] } };
}

/** A computed amount (amount × rate, a balance delta) must stay within the stored-amount bound. */
export function checkDerivedAmount(value: number, field: string, what: string): IntegrityProblem | null {
  if (Math.abs(value) <= MAX_AMOUNT) return null;
  const msg = `${what} is too large`;
  return { error: msg, fieldErrors: { [field]: [msg] } };
}
