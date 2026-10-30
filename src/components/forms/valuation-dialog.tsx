"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatPercent, fromMinor, parseMoneyInput, toMinor } from "@/lib/money";
import type { Account, FieldErrors, ValuationInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import { setValuation } from "@/server/actions/investments";
import {
  AccountSelect,
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  MoneyInput,
  errorOf,
  unmappedError,
  useControllableOpen,
  type DialogControlProps,
} from "./form-kit";

export interface ValuationDialogProps extends DialogControlProps {
  options: { today: string; investmentAccounts: Account[] };
  defaults?: { accountId?: string };
  /** Current value and net deposited per account (account currency) — for the preview. */
  current: Record<string, { value: number; netDeposited: number }>;
  onSaved?: () => void;
}

const SHOWN = ["accountId", "date", "value", "note"] as const;

/**
 * "Update value" / "Update balance": what an investment account is worth (e.g. from the IBKR app), or a
 * bank deposit's balance with interest, on a date.
 */
export function ValuationDialog({ open, onOpenChange, trigger, ...rest }: ValuationDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  const preset = rest.options.investmentAccounts.find((a) => a.id === rest.defaults?.accountId);
  const deposit = preset?.group === "deposits";
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      title={deposit ? "Update balance" : "Update value"}
      description={
        deposit
          ? "Enter the deposit's balance with interest (from your bank). Money put in after this date still counts on top."
          : "Enter what the account is worth (e.g. the net liquidation value in IBKR, or a deposit's balance with interest). Money put in after this date still counts on top."
      }
    >
      <ValuationForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

function ValuationForm({ options, defaults, current, onSaved, onDone }: Omit<ValuationDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const accounts = options.investmentAccounts;
  const [accountId, setAccountId] = useState(accounts.find((a) => a.id === defaults?.accountId)?.id ?? accounts[0]?.id ?? "");
  const [valueText, setValueText] = useState("");
  const [date, setDate] = useState(options.today);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const account = accounts.find((a) => a.id === accountId);
  const now = account ? current[account.id] : undefined;
  const parsed = parseMoneyInput(valueText);
  const value = parsed !== null && parsed >= 0 ? parsed : null;
  // Preview against today's figures (an update dated today replaces the current value).
  const gain = value !== null && now && date === options.today ? fromMinor(toMinor(value) - toMinor(now.netDeposited)) : null;
  const change = value !== null && now && date === options.today ? fromMinor(toMinor(value) - toMinor(now.value)) : null;

  function submit() {
    const next: FieldErrors = {};
    if (!account) next.accountId = ["Choose an investment or deposit account"];
    if (value === null) next.value = ["Enter the value (0 or more, at most 2 decimals)"];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    const input: ValuationInput = { accountId: account!.id, date, value: value!, note: note.trim() || null };
    startTransition(async () => {
      const res = await setValuation(input);
      if (res.ok) {
        toast.success("Value updated");
        onSaved?.();
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  return (
    <DialogForm
      onSubmit={submit}
      footer={
        <DialogFormFooter pending={pending} submitLabel={account?.group === "deposits" ? "Update balance" : "Update value"}>
          {gain !== null && account ? (
            <span data-testid="valuation-preview">
              {account?.group === "deposits" ? "Interest earned" : "Overall gain"}:{" "}
              <Money amount={gain} currency={account.currency} signed className={cn("font-medium", gain > 0 ? "text-positive" : gain < 0 ? "text-negative" : "text-foreground")} />
              {now && now.netDeposited > 0 ? ` (${formatPercent(gain / now.netDeposited, 1)})` : ""}
            </span>
          ) : null}
        </DialogFormFooter>
      }
    >
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.accountId || undefined}>
          <FieldLabel htmlFor="val-account">Account</FieldLabel>
          <AccountSelect
            id="val-account"
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            grouped={new Set(accounts.map((a) => a.group)).size > 1}
            invalid={!!errors.accountId}
          />
          <FieldError>{errorOf(errors, "accountId")}</FieldError>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.value || undefined}>
            <FieldLabel htmlFor="val-value">{account?.group === "deposits" ? "Current balance (with interest)" : "Current value"}</FieldLabel>
            <MoneyInput id="val-value" autoFocus value={valueText} onChange={setValueText} currency={account?.currency} invalid={!!errors.value} />
            {now && account ? (
              <FieldDescription className="text-xs">
                In the app now: <Money amount={now.value} currency={account.currency} />
                {change !== null && change !== 0 ? (
                  <>
                    {" "}
                    · change <Money amount={change} currency={account.currency} signed />
                  </>
                ) : null}
              </FieldDescription>
            ) : null}
            <FieldError>{errorOf(errors, "value")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.date || undefined}>
            <FieldLabel htmlFor="val-date">As of</FieldLabel>
            <DatePicker id="val-date" value={date} onChange={setDate} today={options.today} max={options.today} invalid={!!errors.date} />
            <FieldError>{errorOf(errors, "date")}</FieldError>
          </Field>
        </div>
        <Field data-invalid={!!errors.note || undefined}>
          <FieldLabel htmlFor="val-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="val-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. From the IBKR app" />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
