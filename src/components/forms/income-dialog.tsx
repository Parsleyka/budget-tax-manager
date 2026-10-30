"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { RateHint } from "@/components/shared/rate-hint";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/dates";
import { convertToUah, formatRate, parseMoneyInput, parseRateInput, subtractMoney } from "@/lib/money";
import type { Account, Currency, FieldErrors, Income, IncomeInput, IncomeKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { createIncome, updateIncome } from "@/server/actions/incomes";
import type { FormOptions } from "@/server/queries";
import {
  AccountSelect,
  CurrencyToggle,
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  MoneyInput,
  clearFieldErrors,
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

export type IncomeDialogOptions = Pick<FormOptions, "today" | "accounts" | "defaultActiveAccountId" | "defaultFreelancerAccountIds">;

export interface IncomeDialogProps extends DialogControlProps {
  /** "salary" (UAH, no tax) or "freelance" (USD/EUR/UAH at the NBU rate). Ignored when editing (`income.kind` wins). */
  mode?: IncomeKind;
  options: IncomeDialogOptions;
  /** Edit mode. Pass an `IncomeRow` (carries `account`) so an archived account stays selectable. */
  income?: Income & { account?: Account | null };
  /** Create-mode defaults. */
  defaults?: { date?: string; accountId?: string; currency?: Currency; amount?: number; counterparty?: string; note?: string };
  onSaved?: (income: Income) => void;
}

/** Add / edit a salary or freelance income. */
export function IncomeDialog({ open, onOpenChange, trigger, mode = "salary", ...rest }: IncomeDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  const kind = rest.income?.kind ?? mode;
  const editing = !!rest.income;
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      size={kind === "freelance" ? "lg" : "md"}
      title={kind === "salary" ? (editing ? "Edit salary" : "Add salary") : editing ? "Edit freelance income" : "Add freelance income"}
      description={
        editing
          ? undefined
          : kind === "salary"
            ? "Net salary credited to a UAH account. Salary is never taxed by the app."
            : "Converted at the official NBU rate of the date the money was credited — that UAH amount is your taxable income."
      }
    >
      <IncomeForm {...rest} kind={kind} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

const SHOWN = ["amount", "currency", "accountId", "date", "note", "rate", "fee", "counterparty"] as const;

type FormProps = Omit<IncomeDialogProps, keyof DialogControlProps | "mode"> & { kind: IncomeKind; onDone: () => void };

function IncomeForm({ kind, options, income, defaults, onSaved, onDone }: FormProps) {
  const freelance = kind === "freelance";
  const allAccounts = withCurrent(options.accounts, income?.account ?? null);

  const accountsFor = (cur: Currency) => {
    const list = allAccounts.filter((a) => a.currency === cur);
    // Freelance income usually lands on a freelancer (ФОП) account — list those first.
    return freelance ? [...list.filter((a) => a.group === "freelancer"), ...list.filter((a) => a.group !== "freelancer")] : list;
  };
  const defaultAccountFor = (cur: Currency): string => {
    const list = accountsFor(cur);
    const preferred = freelance ? options.defaultFreelancerAccountIds[cur] : options.defaultActiveAccountId;
    if (defaults?.accountId && list.some((a) => a.id === defaults.accountId)) return defaults.accountId;
    if (preferred && list.some((a) => a.id === preferred)) return preferred;
    return list[0]?.id ?? "";
  };

  const initialCurrency: Currency = freelance ? (income?.currency ?? defaults?.currency ?? "USD") : "UAH";
  const [currency, setCurrency] = useState<Currency>(initialCurrency);
  const [amount, setAmount] = useState(moneyToInput(income?.amount ?? defaults?.amount));
  const [accountId, setAccountId] = useState(income?.accountId ?? defaultAccountFor(initialCurrency));
  const [date, setDate] = useState(income?.date ?? defaults?.date ?? options.today);
  const [fee, setFee] = useState(moneyToInput(income?.fee));
  const [counterparty, setCounterparty] = useState(income?.counterparty ?? defaults?.counterparty ?? "");
  const [note, setNote] = useState(income?.note ?? defaults?.note ?? "");
  const [manual, setManual] = useState(income?.rateSource === "manual");
  const [rateText, setRateText] = useState(income?.rateSource === "manual" ? rateToInput(income.rate) : "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const accounts = accountsFor(currency);
  const foreign = currency !== "UAH";
  const nbu = useNbuRate(currency, date, freelance && foreign && !manual);
  const needsManual = foreign && (manual || nbu.status === "stale" || nbu.status === "unavailable" || nbu.status === "error");

  const parsedAmount = parseMoneyInput(amount);
  const parsedFee = fee.trim() === "" ? null : parseMoneyInput(fee);
  const parsedRate = parseRateInput(rateText);
  const rate = !foreign ? 1 : needsManual ? parsedRate : nbu.status === "ok" ? nbu.result.rate : null;
  const validAmount = parsedAmount !== null && parsedAmount > 0 ? parsedAmount : null;
  const uah = validAmount !== null && rate ? convertToUah(validAmount, rate) : null;
  const credited = validAmount !== null && parsedFee && parsedFee > 0 && parsedFee < validAmount ? subtractMoney(validAmount, parsedFee) : null;

  function changeCurrency(next: Currency) {
    if (next === currency) return;
    setCurrency(next);
    if (!allAccounts.some((a) => a.id === accountId && a.currency === next)) setAccountId(defaultAccountFor(next));
    // A rate typed for USD is not a EUR rate: start over with the NBU lookup for the new currency
    // (it asks for a manual rate again only when NBU has none).
    setRateText("");
    setManual(false);
    setErrors((e) => clearFieldErrors(e, "currency", "accountId", "rate"));
  }

  function submit() {
    const next: FieldErrors = {};
    if (validAmount === null) next.amount = [invalidAmountMessage(amount)];
    if (!accountId) next.accountId = [`Choose a ${currency} account`];
    if (freelance && fee.trim() !== "" && (parsedFee === null || parsedFee < 0)) next.fee = ["Enter a valid fee (at most 2 decimals)"];
    else if (freelance && parsedFee && validAmount !== null && parsedFee >= validAmount) next.fee = ["Fee must be less than the amount"];
    if (needsManual && parsedRate === null) next.rate = ["Enter the rate (UAH per 1 unit, up to 4 decimals)"];
    if (freelance && foreign && !needsManual && nbu.status === "loading") next.rate = ["Waiting for the NBU rate…"];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    const input: IncomeInput = {
      kind,
      date,
      amount: validAmount!,
      currency,
      accountId,
      fee: freelance && parsedFee ? parsedFee : null,
      rateSource: needsManual ? "manual" : "nbu",
      rate: needsManual ? parsedRate : null,
      counterparty: counterparty.trim() || null,
      note: note.trim() || null,
    };
    startTransition(async () => {
      const res = income ? await updateIncome(income.id, input) : await createIncome(input);
      if (res.ok) {
        toast.success(income ? "Income updated" : kind === "salary" ? "Salary added" : "Freelance income added");
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

  const amountField = (
    <Field data-invalid={!!errors.amount || undefined}>
      <FieldLabel htmlFor="income-amount">{freelance ? "Amount received (gross)" : "Net amount"}</FieldLabel>
      <MoneyInput id="income-amount" autoFocus value={amount} onChange={setAmount} currency={currency} invalid={!!errors.amount} />
      <FieldError>{errorOf(errors, "amount")}</FieldError>
    </Field>
  );

  return (
    <DialogForm
      onSubmit={submit}
      footer={
        <DialogFormFooter pending={pending} submitLabel={income ? "Save changes" : kind === "salary" ? "Add salary" : "Add income"} />
      }
    >
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        {freelance ? (
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <Field data-invalid={!!errors.currency || undefined}>
              <FieldLabel htmlFor="income-currency">Currency</FieldLabel>
              <CurrencyToggle id="income-currency" value={currency} onChange={changeCurrency} />
              <FieldError>{errorOf(errors, "currency")}</FieldError>
            </Field>
            {amountField}
          </div>
        ) : (
          amountField
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.date || undefined}>
            <FieldLabel htmlFor="income-date">{freelance ? "Date credited" : "Date"}</FieldLabel>
            <DatePicker id="income-date" value={date} onChange={setDate} today={options.today} max={options.today} invalid={!!errors.date} />
            <FieldError>{errorOf(errors, "date")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.accountId || undefined}>
            <FieldLabel htmlFor="income-account">Account</FieldLabel>
            <AccountSelect
              id="income-account"
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              invalid={!!errors.accountId}
              placeholder={accounts.length ? "Choose an account" : `No ${currency} accounts`}
            />
            <FieldError>{errorOf(errors, "accountId")}</FieldError>
          </Field>
        </div>

        {freelance ? (
          <div
            className={cn("rounded-lg border bg-muted/40 p-3", errors.rate && "border-destructive/50")}
            data-slot="income-rate-panel"
          >
            {foreign ? (
              <Field data-invalid={!!errors.rate || undefined} className="gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="income-rate" className="text-xs font-medium text-muted-foreground">
                    Exchange rate
                  </FieldLabel>
                  <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setManual(!manual)}>
                    {manual ? "Use NBU rate" : "Enter manually"}
                  </Button>
                </div>
                {needsManual ? (
                  <>
                    <MoneyInput id="income-rate" value={rateText} onChange={setRateText} placeholder="e.g. 41,2345" invalid={!!errors.rate} className="bg-background" />
                    <FieldDescription className="text-xs">
                      {nbu.status === "stale"
                        ? `No official NBU rate for ${formatDate(date)} yet (latest: ${formatRate(nbu.result.rate)} from ${formatDate(nbu.result.effectiveDate)}). Enter the rate manually.`
                        : nbu.status === "unavailable" || nbu.status === "error"
                          ? `${nbu.error}. Enter the rate manually (UAH per 1 ${currency}).`
                          : `UAH per 1 ${currency}. Saved as a manual rate.`}
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
            <div className={cn("flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1", foreign && "mt-3 border-t pt-3")}>
              <span className="text-xs text-muted-foreground">Taxable income (UAH)</span>
              <span className="text-lg font-semibold" data-testid="income-uah-preview">
                {uah !== null ? <Money amount={uah} currency="UAH" /> : <span className="text-muted-foreground">—</span>}
              </span>
            </div>
            {credited !== null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Credited to the account after the fee: <Money amount={credited} currency={currency} />
              </p>
            ) : null}
          </div>
        ) : null}

        <div className={cn("grid gap-4", freelance && "sm:grid-cols-2")}>
          {freelance ? (
            <Field data-invalid={!!errors.fee || undefined}>
              <FieldLabel htmlFor="income-fee">
                Fee <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <MoneyInput id="income-fee" value={fee} onChange={setFee} currency={currency} invalid={!!errors.fee} />
              <FieldDescription className="text-xs">Bank / platform fee. Tax is still on the gross amount.</FieldDescription>
              <FieldError>{errorOf(errors, "fee")}</FieldError>
            </Field>
          ) : null}
          <Field data-invalid={!!errors.counterparty || undefined}>
            <FieldLabel htmlFor="income-counterparty">
              {freelance ? "Client" : "Employer"} <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input
              id="income-counterparty"
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              maxLength={200}
              placeholder={freelance ? "e.g. Acme Inc." : "e.g. Company LLC"}
            />
            <FieldError>{errorOf(errors, "counterparty")}</FieldError>
          </Field>
        </div>

        <Field data-invalid={!!errors.note || undefined}>
          <FieldLabel htmlFor="income-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="income-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={freelance ? "e.g. Invoice #42" : "e.g. October salary"} />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
