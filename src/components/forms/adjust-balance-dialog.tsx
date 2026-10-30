"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountLabel } from "@/components/shared/account-label";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/dates";
import { parseMoneyInput, subtractMoney } from "@/lib/money";
import type { Account, Adjustment, FieldErrors, SetActualBalanceInput } from "@/lib/types";
import { getBalanceOn, setActualBalance } from "@/server/actions/accounts";
import type { FormOptions } from "@/server/queries";
import {
  AccountSelect,
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  MoneyInput,
  errorOf,
  invalidAmountMessage,
  unmappedError,
  useControllableOpen,
  withCurrent,
  type DialogControlProps,
} from "./form-kit";

export type AdjustBalanceDialogOptions = Pick<FormOptions, "today" | "accounts" | "balances">;

export interface AdjustBalanceDialogProps extends DialogControlProps {
  options: AdjustBalanceDialogOptions;
  /** Preselected account. */
  accountId?: string;
  /** Hide the account picker (the dialog was opened from that account's row). Requires `accountId`. */
  lockAccount?: boolean;
  /** The account object when it may be archived / missing from `options.accounts`. */
  account?: Account | null;
  /** Override today's balance (default: `options.balances[accountId]`). Other dates are looked up on the server. */
  currentBalance?: number;
  defaults?: { date?: string; note?: string };
  onSaved?: (adjustment: Adjustment) => void;
}

/**
 * "Update balance": the user types the ACTUAL balance on a date (today by default, or a statement date —
 * e.g. IBKR market value, deposit with interest); the server stores an adjustment on that date of
 * delta = new − balance on that date, so movements after it keep counting.
 */
export function AdjustBalanceDialog({ open, onOpenChange, trigger, ...rest }: AdjustBalanceDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      size="sm"
      title="Update balance"
      description="Enter what the account held on the chosen date (today by default). The difference to the balance on that date is recorded as an adjustment; later movements still count on top of it."
    >
      <AdjustBalanceForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

const SHOWN = ["accountId", "newBalance", "date", "note"] as const;

function AdjustBalanceForm({
  options,
  accountId: initialId,
  lockAccount,
  account: accountProp,
  currentBalance,
  defaults,
  onSaved,
  onDone,
}: Omit<AdjustBalanceDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const accounts = withCurrent(options.accounts, accountProp ?? null);
  const [accountId, setAccountId] = useState(initialId && accounts.some((a) => a.id === initialId) ? initialId : "");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(defaults?.date ?? options.today);
  const [note, setNote] = useState(defaults?.note ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const account = accounts.find((a) => a.id === accountId);
  const todayBalance = account ? (accountId === initialId && currentBalance !== undefined ? currentBalance : (options.balances[account.id] ?? 0)) : null;
  // A past date compares with the balance ON that date (what the server does), fetched on demand.
  const pastDate = !!account && date !== options.today;
  const key = `${accountId}|${date}`;
  const [asOf, setAsOf] = useState<{ key: string; balance: number | null } | null>(null);
  useEffect(() => {
    if (!pastDate) return;
    let cancelled = false;
    getBalanceOn(accountId, date).then(
      (r) => {
        if (!cancelled) setAsOf({ key, balance: r.ok ? r.data : null });
      },
      () => {
        if (!cancelled) setAsOf({ key, balance: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pastDate, accountId, date, key]);
  const loadingAsOf = pastDate && asOf?.key !== key;
  const current = !account ? null : pastDate ? (asOf?.key === key ? asOf.balance : null) : todayBalance;
  const parsed = value.trim() === "" ? null : parseMoneyInput(value);
  const delta = parsed !== null && current !== null ? subtractMoney(parsed, current) : null;

  function submit() {
    const next: FieldErrors = {};
    if (!accountId) next.accountId = ["Choose an account"];
    if (parsed === null) next.newBalance = [invalidAmountMessage(value, "Enter the actual balance (at most 2 decimals; may be negative)")];
    else if (delta === 0) next.newBalance = [pastDate ? `That is already the balance on ${formatDate(date)}` : "That is already the current balance"];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    const input: SetActualBalanceInput = { accountId, date, newBalance: parsed!, note: note.trim() || null };
    startTransition(async () => {
      const res = await setActualBalance(input);
      if (res.ok) {
        toast.success("Balance updated");
        onSaved?.(res.data);
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  return (
    <DialogForm onSubmit={submit} footer={<DialogFormFooter pending={pending} submitLabel="Update balance" />}>
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        {lockAccount && account ? (
          <div className="rounded-lg border px-3 py-2">
            <AccountLabel account={account} showGroup />
          </div>
        ) : (
          <Field data-invalid={!!errors.accountId || undefined}>
            <FieldLabel htmlFor="adjust-account">Account</FieldLabel>
            <AccountSelect id="adjust-account" accounts={accounts} value={accountId} onChange={setAccountId} invalid={!!errors.accountId} />
            <FieldError>{errorOf(errors, "accountId")}</FieldError>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground" data-testid="adjust-current-label">
              {pastDate ? `Balance on ${formatDate(date)}` : "Current balance"}
            </span>
            <span className="text-sm font-semibold" data-testid="adjust-current">
              {loadingAsOf ? (
                <Spinner className="size-3.5" aria-label="Loading the balance on that date" />
              ) : account && current !== null ? (
                <Money amount={current} currency={account.currency} />
              ) : (
                "—"
              )}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">Change</span>
            <span className="text-sm font-semibold" data-testid="adjust-delta">
              {account && delta !== null ? <Money amount={delta} currency={account.currency} signed colored /> : "—"}
            </span>
          </div>
        </div>

        <Field data-invalid={!!errors.newBalance || undefined}>
          <FieldLabel htmlFor="adjust-new">Actual balance</FieldLabel>
          <MoneyInput id="adjust-new" autoFocus value={value} onChange={setValue} currency={account?.currency} invalid={!!errors.newBalance} />
          <FieldDescription className="text-xs">Negative values are allowed (e.g. a credit card).</FieldDescription>
          <FieldError>{errorOf(errors, "newBalance")}</FieldError>
        </Field>
        <Field data-invalid={!!errors.date || undefined}>
          <FieldLabel htmlFor="adjust-date">As of</FieldLabel>
          <DatePicker id="adjust-date" value={date} onChange={setDate} today={options.today} max={options.today} invalid={!!errors.date} />
          <FieldDescription className="text-xs">For a statement balance, pick the statement date.</FieldDescription>
          <FieldError>{errorOf(errors, "date")}</FieldError>
        </Field>
        <Field data-invalid={!!errors.note || undefined}>
          <FieldLabel htmlFor="adjust-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="adjust-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Market value on statement" />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
