"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/shared/money";
import { RateHint } from "@/components/shared/rate-hint";
import { DatePicker } from "@/components/shared/date-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addMonths, formatDate, formatQuarter, monthOf, quarterKeyOf, type ISODate } from "@/lib/dates";
import { convertToUah, formatRate, parseMoneyInput, parseRateInput } from "@/lib/money";
import {
  TAX_KIND_LABELS,
  type Account,
  type Category,
  type Expense,
  type ExpenseInput,
  type FieldErrors,
  type TaxKind,
} from "@/lib/types";
import { createExpense, updateExpense } from "@/server/actions/expenses";
import type { FormOptions } from "@/server/queries";
import {
  AccountSelect,
  CategorySelect,
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  MoneyInput,
  errorOf,
  invalidAmountMessage,
  moneyToInput,
  rateToInput,
  unmappedError,
  useControllableOpen,
  withCurrent,
  type DialogControlProps,
} from "./form-kit";
import { useNbuRate } from "./use-nbu-rate";

export type ExpenseDialogOptions = Pick<FormOptions, "today" | "accounts" | "categories" | "defaultActiveAccountId">;

export interface ExpenseDialogProps extends DialogControlProps {
  /** From `getFormOptions()` (or any object with these fields). */
  options: ExpenseDialogOptions;
  /** Edit mode. Pass an `ExpenseRow` (it carries `account`/`category`) so archived ones stay selectable. */
  expense?: Expense & { account?: Account | null; category?: Category | null };
  /** Create-mode defaults. */
  defaults?: { date?: string; accountId?: string; categoryId?: string; amount?: number; note?: string };
  /** Called with the saved expense after a successful save (the dialog closes by itself). */
  onSaved?: (expense: Expense) => void;
}

/** Add / edit a spending. Non-UAH accounts get a live NBU rate preview and a manual-rate fallback. */
export function ExpenseDialog({ open, onOpenChange, trigger, ...rest }: ExpenseDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      title={rest.expense ? "Edit spending" : "Add spending"}
      description={rest.expense ? undefined : "Record money you spent from one of your accounts."}
    >
      <ExpenseForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

const SHOWN = ["amount", "categoryId", "accountId", "date", "note", "rate", "taxMeta"] as const;

const TAX_LINK_KINDS: readonly TaxKind[] = ["single_tax", "military_levy", "esv"];

/** The quarter a tax paid on `date` is usually for: the previous one (taxes are paid after the quarter). */
function likelyTaxQuarter(date: ISODate): string {
  return quarterKeyOf(addMonths(monthOf(date), -3));
}

/** The last 8 quarters up to today's (newest first), plus `current` if it is older. */
function taxQuarterChoices(today: ISODate, current: string | null): string[] {
  const out: string[] = [];
  for (let i = 0; i < 8; i++) out.push(quarterKeyOf(addMonths(monthOf(today), -3 * i)));
  if (current && !out.includes(current)) out.push(current);
  return out;
}

function ExpenseForm({ options, expense, defaults, onSaved, onDone }: Omit<ExpenseDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const accounts = withCurrent(options.accounts, expense?.account ?? null);
  const categories = withCurrent(options.categories, expense?.category ?? null);
  const initialAccount =
    expense?.accountId ??
    (defaults?.accountId && accounts.some((a) => a.id === defaults.accountId) ? defaults.accountId : undefined) ??
    (accounts.some((a) => a.id === options.defaultActiveAccountId) ? options.defaultActiveAccountId : accounts[0]?.id ?? "");

  const [amount, setAmount] = useState(moneyToInput(expense?.amount ?? defaults?.amount));
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? defaults?.categoryId ?? "");
  const [accountId, setAccountId] = useState(initialAccount);
  const [date, setDate] = useState(expense?.date ?? defaults?.date ?? options.today);
  const [note, setNote] = useState(expense?.note ?? defaults?.note ?? "");
  const [manual, setManual] = useState(expense?.rateSource === "manual");
  const [rateText, setRateText] = useState(expense?.rateSource === "manual" ? rateToInput(expense.rate) : "");
  const [taxKind, setTaxKind] = useState<TaxKind | "none">(expense?.taxMeta?.kind ?? "none");
  const [taxPeriod, setTaxPeriod] = useState<string>(expense?.taxMeta?.period ?? likelyTaxQuarter(expense?.date ?? options.today));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const account = accounts.find((a) => a.id === accountId);
  const currency = account?.currency ?? "UAH";
  const isTaxes = categories.find((c) => c.id === categoryId)?.systemKey === "taxes";

  /** A rate typed for one currency must not be reused for another (e.g. switching FOP USD → FOP EUR). */
  function changeAccount(id: string) {
    const nextCurrency = accounts.find((a) => a.id === id)?.currency;
    if (nextCurrency !== currency) {
      setRateText("");
      setManual(false);
    }
    setAccountId(id);
  }
  const foreign = currency !== "UAH";
  const nbu = useNbuRate(currency, date, foreign && !manual);
  const needsManual = foreign && (manual || nbu.status === "stale" || nbu.status === "unavailable" || nbu.status === "error");

  const parsedAmount = parseMoneyInput(amount);
  const parsedRate = parseRateInput(rateText);
  const previewRate = !foreign ? 1 : needsManual ? parsedRate : nbu.status === "ok" ? nbu.result.rate : null;
  const uahPreview = parsedAmount !== null && parsedAmount > 0 && previewRate ? convertToUah(parsedAmount, previewRate) : null;

  function submit() {
    const next: FieldErrors = {};
    if (parsedAmount === null || parsedAmount <= 0) next.amount = [invalidAmountMessage(amount)];
    if (!categoryId) next.categoryId = ["Choose a category"];
    if (!accountId) next.accountId = ["Choose an account"];
    if (needsManual && parsedRate === null) next.rate = ["Enter the rate (UAH per 1 unit, up to 4 decimals)"];
    if (foreign && !needsManual && nbu.status === "loading") next.rate = ["Waiting for the NBU rate…"];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    const input: ExpenseInput = {
      date,
      amount: parsedAmount!,
      accountId,
      categoryId,
      note: note.trim() || null,
      rateSource: needsManual ? "manual" : "nbu",
      rate: needsManual ? parsedRate : null,
      // Only a Taxes spending carries a tax link (moving it out of Taxes drops the link on the server).
      ...(isTaxes ? { taxMeta: taxKind === "none" ? null : { kind: taxKind, period: taxPeriod } } : {}),
    };
    startTransition(async () => {
      const res = expense ? await updateExpense(expense.id, input) : await createExpense(input);
      if (res.ok) {
        toast.success(expense ? "Spending updated" : "Spending added");
        onSaved?.(res.data);
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      if (res.fieldErrors?.rate) setManual(true);
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  return (
    <DialogForm
      onSubmit={submit}
      footer={
        <DialogFormFooter pending={pending} submitLabel={expense ? "Save changes" : "Add spending"}>
          {uahPreview !== null && foreign ? (
            <>
              ≈ <Money amount={uahPreview} currency="UAH" />
            </>
          ) : null}
        </DialogFormFooter>
      }
    >
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.amount || undefined}>
          <FieldLabel htmlFor="expense-amount">Amount</FieldLabel>
          <MoneyInput id="expense-amount" autoFocus value={amount} onChange={setAmount} currency={currency} invalid={!!errors.amount} />
          <FieldError>{errorOf(errors, "amount")}</FieldError>
        </Field>
        <Field data-invalid={!!errors.categoryId || undefined}>
          <FieldLabel htmlFor="expense-category">Category</FieldLabel>
          <CategorySelect id="expense-category" categories={categories} value={categoryId} onChange={setCategoryId} invalid={!!errors.categoryId} />
          <FieldError>{errorOf(errors, "categoryId")}</FieldError>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.accountId || undefined}>
            <FieldLabel htmlFor="expense-account">Account</FieldLabel>
            <AccountSelect id="expense-account" accounts={accounts} value={accountId} onChange={changeAccount} invalid={!!errors.accountId} />
            <FieldError>{errorOf(errors, "accountId")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.date || undefined}>
            <FieldLabel htmlFor="expense-date">Date</FieldLabel>
            <DatePicker id="expense-date" value={date} onChange={setDate} today={options.today} max={options.today} invalid={!!errors.date} />
            <FieldError>{errorOf(errors, "date")}</FieldError>
          </Field>
        </div>
        {isTaxes ? (
          <Field data-invalid={!!errors.taxMeta || undefined} data-testid="expense-tax-link">
            <FieldLabel htmlFor="expense-tax-kind">ФОП tax payment</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <Select value={taxKind} onValueChange={(v) => setTaxKind(v as TaxKind | "none")}>
                <SelectTrigger id="expense-tax-kind" className="w-full" aria-invalid={!!errors.taxMeta || undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="none">Not a ФОП tax payment</SelectItem>
                  {TAX_LINK_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {TAX_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {taxKind !== "none" ? (
                <Select value={taxPeriod} onValueChange={setTaxPeriod}>
                  <SelectTrigger className="w-full" aria-label="Quarter it pays for">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {taxQuarterChoices(options.today, taxPeriod).map((q) => (
                      <SelectItem key={q} value={q}>
                        for {formatQuarter(q)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <FieldDescription className="text-xs">
              {taxKind === "none" ? (
                <>
                  Paying a ФОП tax? Link it to the quarter so the{" "}
                  <Link href="/freelance#declarations" className="underline underline-offset-2">
                    Freelancer page
                  </Link>{" "}
                  counts it as paid — or use Freelancer → Record tax payment for several taxes at once.
                </>
              ) : (
                "Counted as paid for that quarter on the Freelancer page."
              )}
            </FieldDescription>
            <FieldError>{errorOf(errors, "taxMeta")}</FieldError>
          </Field>
        ) : null}
        {foreign ? (
          <Field data-invalid={!!errors.rate || undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="expense-rate">Exchange rate</FieldLabel>
              <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setManual(!manual)}>
                {manual ? "Use NBU rate" : "Enter manually"}
              </Button>
            </div>
            {needsManual ? (
              <>
                <MoneyInput id="expense-rate" value={rateText} onChange={setRateText} placeholder="e.g. 41,2345" invalid={!!errors.rate} />
                <FieldDescription>
                  {nbu.status === "stale"
                    ? `No official NBU rate for this date yet (latest: ${formatRate(nbu.result.rate)} from ${formatDate(nbu.result.effectiveDate)}).`
                    : manual
                      ? "UAH per 1 unit of the account currency."
                      : "NBU rate unavailable — enter the rate (UAH per 1 unit)."}
                </FieldDescription>
              </>
            ) : (
              <RateHint
                currency={currency}
                loading={nbu.status === "loading"}
                rate={nbu.status === "ok" ? nbu.result.rate : null}
                date={date}
                effectiveDate={nbu.status === "ok" ? nbu.result.effectiveDate : null}
              />
            )}
            <FieldError>{errorOf(errors, "rate")}</FieldError>
          </Field>
        ) : null}
        <Field data-invalid={!!errors.note || undefined}>
          <FieldLabel htmlFor="expense-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="expense-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Silpo, weekly groceries" />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
