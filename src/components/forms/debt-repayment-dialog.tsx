"use client";

import { RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountLabel } from "@/components/shared/account-label";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_SYMBOL, convertToUah, fromMinor, parseMoneyInput, round2, toMinor } from "@/lib/money";
import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type Account, type Currency, type Debt, type DebtRepaymentInput, type FieldErrors } from "@/lib/types";
import { addDebtRepayment } from "@/server/actions/debts";
import {
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  MoneyInput,
  errorOf,
  invalidAmountMessage,
  moneyToInput,
  unmappedError,
  useControllableOpen,
  type DialogControlProps,
} from "./form-kit";
import type { DebtDialogOptions } from "./debt-dialog";
import { useNbuRate, type NbuRateState } from "./use-nbu-rate";

export interface DebtRepaymentDialogProps extends DialogControlProps {
  /** `accounts` (non-archived) + `defaultActiveAccountId` enable the "Received into / Paid from" choice. */
  options: DebtDialogOptions;
  debt: Debt;
  /** What is still outstanding (debt currency) — the default and maximum amount. */
  outstanding: number;
  onSaved?: (debt: Debt) => void;
}

/** Record a full or partial return of a debt, optionally into / from one of your accounts. */
export function DebtRepaymentDialog({ open, onOpenChange, trigger, ...rest }: DebtRepaymentDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  const { debt } = rest;
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      title={debt.direction === "lent" ? `${debt.counterparty} paid you back` : `You paid ${debt.counterparty} back`}
      description="Record a full or partial repayment."
    >
      <RepaymentForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

const NONE = "__none__";
const SHOWN = ["amount", "date", "accountId", "accountAmount", "note"] as const;

/** Same-currency account first (the main card for UAH), otherwise none. */
function defaultAccount(currency: Currency, accounts: readonly Account[], mainId: string | undefined): string {
  if (currency === "UAH" && mainId && accounts.some((a) => a.id === mainId)) return mainId;
  return accounts.find((a) => a.currency === currency)?.id ?? NONE;
}

function rateOf(currency: Currency | undefined, state: NbuRateState): number | null {
  if (!currency) return null;
  if (currency === "UAH") return 1;
  return state.status === "ok" || state.status === "stale" ? state.result.rate : null;
}

function RepaymentForm({ options, debt, outstanding, onSaved, onDone }: Omit<DebtRepaymentDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const lent = debt.direction === "lent";
  const accounts = options.accounts ?? [];
  const [amountText, setAmountText] = useState(moneyToInput(outstanding));
  const [date, setDate] = useState(options.today < debt.date ? debt.date : options.today);
  const [accountId, setAccountId] = useState(() => defaultAccount(debt.currency, accounts, options.defaultActiveAccountId));
  const [accountText, setAccountText] = useState("");
  const [accountTouched, setAccountTouched] = useState(false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const account = accountId === NONE ? undefined : accounts.find((a) => a.id === accountId);
  const cross = !!account && account.currency !== debt.currency;
  const amount = parseMoneyInput(amountText);
  const valid = amount !== null && amount > 0 ? amount : null;
  const after = valid !== null ? fromMinor(toMinor(outstanding) - toMinor(valid)) : null;

  // Cross-currency (e.g. a złoty debt paid from a UAH card): prefill at the NBU cross rate.
  const debtRate = useNbuRate(debt.currency, date, cross);
  const accRate = useNbuRate(account?.currency ?? "UAH", date, cross);
  let suggestion: number | null = null;
  const rDebt = rateOf(debt.currency, debtRate);
  const rAcc = rateOf(account?.currency, accRate);
  if (cross && valid !== null && rDebt && rAcc) {
    const uah = convertToUah(valid, rDebt);
    suggestion = account!.currency === "UAH" ? uah : round2(uah / rAcc);
  }
  const accountDisplay = accountTouched ? accountText : suggestion !== null ? moneyToInput(suggestion) : "";
  const accountAmount = parseMoneyInput(accountDisplay);

  function submit() {
    const next: FieldErrors = {};
    if (valid === null) next.amount = [invalidAmountMessage(amountText)];
    else if (toMinor(valid) > toMinor(outstanding)) next.amount = ["That's more than what is outstanding"];
    if (cross && (accountAmount === null || accountAmount <= 0)) next.accountAmount = [`Enter the amount in ${account!.currency} (at most 2 decimals)`];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    const input: DebtRepaymentInput = {
      date,
      amount: valid!,
      accountId: account?.id ?? null,
      accountAmount: cross ? accountAmount : null,
      note: note.trim() || null,
    };
    startTransition(async () => {
      const res = await addDebtRepayment(debt.id, input);
      if (res.ok) {
        const settled = toMinor(valid!) === toMinor(outstanding);
        toast.success(settled ? `Settled — ${debt.counterparty} and you are even` : "Repayment saved");
        onSaved?.(res.data);
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  const groups = ACCOUNT_GROUPS.map((g) => ({ g, items: accounts.filter((a) => a.group === g) })).filter((x) => x.items.length);

  return (
    <DialogForm
      onSubmit={submit}
      footer={
        <DialogFormFooter pending={pending} submitLabel="Save repayment">
          {after !== null && after >= 0 ? (
            after === 0 ? (
              <span className="font-medium text-positive">Fully repaid</span>
            ) : (
              <span>
                Still outstanding after: <Money amount={after} currency={debt.currency} className="font-medium text-foreground" />
              </span>
            )
          ) : null}
        </DialogFormFooter>
      }
    >
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.amount || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="repayment-amount">Amount</FieldLabel>
            <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setAmountText(moneyToInput(outstanding))}>
              Full amount
            </Button>
          </div>
          <MoneyInput id="repayment-amount" value={amountText} onChange={setAmountText} currency={debt.currency} invalid={!!errors.amount} />
          <FieldDescription className="text-xs">
            Outstanding: <Money amount={outstanding} currency={debt.currency} />
          </FieldDescription>
          <FieldError>{errorOf(errors, "amount")}</FieldError>
        </Field>

        <Field data-invalid={!!errors.accountId || undefined}>
          <FieldLabel htmlFor="repayment-account">{lent ? "Received into" : "Paid from"}</FieldLabel>
          <Select
            value={accountId}
            onValueChange={(v) => {
              setAccountId(v);
              setAccountTouched(false);
            }}
          >
            <SelectTrigger id="repayment-account" className="w-full" aria-invalid={!!errors.accountId || undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-80">
              <SelectItem value={NONE}>None — don&apos;t change any balance</SelectItem>
              {groups.length ? <SelectSeparator /> : null}
              {groups.map(({ g, items }) => (
                <SelectGroup key={g}>
                  <SelectLabel>{ACCOUNT_GROUP_LABELS[g]}</SelectLabel>
                  {items.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <AccountLabel account={a} />
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription className="text-xs">
            {account
              ? `${account.name} ${lent ? "goes up" : "goes down"} by this repayment.`
              : "No balance changes — e.g. cash you don't track here."}
          </FieldDescription>
          <FieldError>{errorOf(errors, "accountId")}</FieldError>
        </Field>

        {cross ? (
          <Field data-invalid={!!errors.accountAmount || undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="repayment-account-amount">
                {lent ? `Amount received in ${account!.name}` : `Amount paid from ${account!.name}`}
              </FieldLabel>
              {accountTouched && suggestion !== null ? (
                <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setAccountTouched(false)}>
                  <RotateCcw /> NBU
                </Button>
              ) : null}
            </div>
            <MoneyInput
              id="repayment-account-amount"
              value={accountDisplay}
              onChange={(v) => {
                setAccountTouched(true);
                setAccountText(v);
              }}
              currency={account!.currency}
              invalid={!!errors.accountAmount}
              placeholder={debtRate.status === "loading" || accRate.status === "loading" ? "Fetching rate…" : "0,00"}
            />
            <FieldDescription className="text-xs">
              {accountTouched
                ? "Entered manually."
                : `Prefilled at the NBU rate (${CURRENCY_SYMBOL[debt.currency]} → ${CURRENCY_SYMBOL[account!.currency]}) — edit to match your bank.`}
            </FieldDescription>
            <FieldError>{errorOf(errors, "accountAmount")}</FieldError>
          </Field>
        ) : null}

        <Field data-invalid={!!errors.date || undefined}>
          <FieldLabel htmlFor="repayment-date">Date</FieldLabel>
          <DatePicker id="repayment-date" value={date} onChange={setDate} today={options.today} min={debt.date} max={options.today} invalid={!!errors.date} />
          <FieldError>{errorOf(errors, "date")}</FieldError>
        </Field>

        <Field data-invalid={!!errors.note || undefined}>
          <FieldLabel htmlFor="repayment-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="repayment-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
