"use client";

import { ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseMoneyInput } from "@/lib/money";
import type { Currency, Debt, DebtDirection, DebtInput, FieldErrors } from "@/lib/types";
import { createDebt, updateDebt } from "@/server/actions/debts";
import type { FormOptions } from "@/server/queries";
import {
  CurrencyToggle,
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

/** `accounts` / `defaultActiveAccountId` are used by the repayment dialog ("Received into / Paid from"). */
export type DebtDialogOptions = Pick<FormOptions, "today"> & Partial<Pick<FormOptions, "accounts" | "defaultActiveAccountId">>;

export interface DebtDialogProps extends DialogControlProps {
  options: DebtDialogOptions;
  /** Create mode: which side the form starts on (default "lent"). */
  direction?: DebtDirection;
  /** Edit mode. */
  debt?: Debt;
  /** Names used before — offered as suggestions for "Who". */
  people?: readonly string[];
  onSaved?: (debt: Debt) => void;
}

const CURRENCIES: readonly Currency[] = ["UAH", "USD", "EUR", "PLN"];
const SHOWN = ["direction", "counterparty", "amount", "currency", "date", "dueDate", "note"] as const;

/**
 * Money you lent (they owe you) or borrowed (you owe them), with an optional due date.
 * A separate tracker: saving a debt never changes any account balance.
 */
export function DebtDialog({ open, onOpenChange, trigger, ...rest }: DebtDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  const editing = !!rest.debt;
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      title={editing ? "Edit debt" : "New debt"}
      description={editing ? undefined : "Keep track of who owes whom and when it should be returned. Your account balances are not changed."}
    >
      <DebtForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

function DebtForm({ options, direction: initialDirection, debt, people, onSaved, onDone }: Omit<DebtDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const peopleListId = useId();
  const hasRepayments = (debt?.repayments.length ?? 0) > 0;

  const [direction, setDirection] = useState<DebtDirection>(debt?.direction ?? initialDirection ?? "lent");
  const [counterparty, setCounterparty] = useState(debt?.counterparty ?? "");
  const [amountText, setAmountText] = useState(moneyToInput(debt?.amount));
  const [currency, setCurrency] = useState<Currency>(debt?.currency ?? "UAH");
  const [date, setDate] = useState(debt?.date ?? options.today);
  const [dueDate, setDueDate] = useState<string | null>(debt?.dueDate ?? null);
  const [note, setNote] = useState(debt?.note ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = parseMoneyInput(amountText);
  const validAmount = amount !== null && amount > 0 ? amount : null;

  function submit() {
    const next: FieldErrors = {};
    if (!counterparty.trim()) next.counterparty = ["Who is it? Enter a name"];
    if (validAmount === null) next.amount = [invalidAmountMessage(amountText)];
    if (dueDate && dueDate < date) next.dueDate = ["The due date cannot be before the debt date"];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    const input: DebtInput = {
      direction,
      counterparty: counterparty.trim(),
      date,
      amount: validAmount!,
      currency,
      dueDate,
      note: note.trim() || null,
    };
    startTransition(async () => {
      const res = debt ? await updateDebt(debt.id, input) : await createDebt(input);
      if (res.ok) {
        toast.success(debt ? "Debt updated" : direction === "lent" ? "Loan saved" : "Debt saved");
        onSaved?.(res.data);
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  const lent = direction === "lent";
  return (
    <DialogForm onSubmit={submit} footer={<DialogFormFooter pending={pending} submitLabel={debt ? "Save changes" : "Save"} />}>
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="debt-direction">Type</FieldLabel>
          <ToggleGroup
            id="debt-direction"
            type="single"
            variant="outline"
            spacing={0}
            value={direction}
            onValueChange={(v) => v && setDirection(v as DebtDirection)}
            aria-label="Debt type"
            className="w-full"
          >
            <ToggleGroupItem value="lent" className="flex-1 gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground">
              <ArrowUpRight aria-hidden /> I lent
            </ToggleGroupItem>
            <ToggleGroupItem value="borrowed" className="flex-1 gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground">
              <ArrowDownLeft aria-hidden /> I borrowed
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription className="text-xs">{lent ? "They owe you this money." : "You owe them this money."}</FieldDescription>
        </Field>

        <Field data-invalid={!!errors.counterparty || undefined}>
          <FieldLabel htmlFor="debt-counterparty">{lent ? "Lent to" : "Borrowed from"}</FieldLabel>
          <Input
            id="debt-counterparty"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            maxLength={120}
            placeholder="Name"
            list={people?.length ? peopleListId : undefined}
            autoComplete="off"
            aria-invalid={!!errors.counterparty || undefined}
          />
          {people?.length ? (
            <datalist id={peopleListId}>
              {people.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          ) : null}
          <FieldError>{errorOf(errors, "counterparty")}</FieldError>
        </Field>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Field data-invalid={!!errors.amount || undefined}>
            <FieldLabel htmlFor="debt-amount">Amount</FieldLabel>
            <MoneyInput id="debt-amount" value={amountText} onChange={setAmountText} currency={currency} invalid={!!errors.amount} />
            <FieldError>{errorOf(errors, "amount")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.currency || undefined}>
            <FieldLabel htmlFor="debt-currency">Currency</FieldLabel>
            <CurrencyToggle id="debt-currency" value={currency} onChange={setCurrency} options={CURRENCIES} disabled={hasRepayments} />
            {hasRepayments ? <FieldDescription className="text-xs">Fixed once repayments are recorded.</FieldDescription> : null}
            <FieldError>{errorOf(errors, "currency")}</FieldError>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.date || undefined}>
            <FieldLabel htmlFor="debt-date">{lent ? "Lent on" : "Borrowed on"}</FieldLabel>
            <DatePicker id="debt-date" value={date} onChange={setDate} today={options.today} max={options.today} invalid={!!errors.date} />
            <FieldError>{errorOf(errors, "date")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.dueDate || undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="debt-due">
                Return by <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              {dueDate ? (
                <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setDueDate(null)}>
                  <X aria-hidden /> Clear
                </Button>
              ) : null}
            </div>
            <DatePicker
              id="debt-due"
              value={dueDate}
              onChange={setDueDate}
              today={options.today}
              min={date}
              endYear={Number(options.today.slice(0, 4)) + 10}
              placeholder="No due date"
              invalid={!!errors.dueDate}
            />
            <FieldError>{errorOf(errors, "dueDate")}</FieldError>
          </Field>
        </div>

        <Field data-invalid={!!errors.note || undefined}>
          <FieldLabel htmlFor="debt-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="debt-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. For the car repair" />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
