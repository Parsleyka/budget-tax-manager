"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AccountSelect,
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  MoneyInput,
  clearFieldErrors,
  errorOf,
  moneyToInput,
  unmappedError,
  useControllableOpen,
  type DialogControlProps,
} from "@/components/forms/form-kit";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate, formatQuarter, type ISODate, type QuarterKey } from "@/lib/dates";
import { formatMoney, parseMoneyInput, sumMoney } from "@/lib/money";
import { TAX_KIND_LABELS, type Account, type FieldErrors, type TaxKind, type TaxPaymentInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import { recordTaxPayment } from "@/server/actions/taxes";
import { buildPaymentLines, defaultPaymentPeriod, levyPaymentNote, TAX_KINDS, type PaymentQuarterOption } from "./model";

export interface RecordTaxPaymentDialogProps extends DialogControlProps {
  /** Quarters of the year with due / paid / outstanding per tax kind (`paymentQuarterOptions`). */
  quarters: PaymentQuarterOption[];
  /** Preselected quarter (default: the oldest finished quarter with something outstanding). */
  defaultPeriod?: QuarterKey | null;
  /** UAH accounts the payment can come from. */
  accounts: Account[];
  defaultAccountId: string;
  /** Today (Kyiv) from the loader. */
  today: ISODate;
  /**
   * "Include ЄСВ" on: minimum ЄСВ per quarter. Where no own ЄСВ is owed, the ЄСВ line is offered as
   * optional — unchecked, prefilled with this amount when ticked.
   */
  optionalEsv?: Record<string, number>;
}

/** "Record tax payment": one Taxes spending per tax kind, linked to the quarter (taxMeta). */
export function RecordTaxPaymentDialog({ open, onOpenChange, trigger, ...rest }: RecordTaxPaymentDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      size="lg"
      title="Record tax payment"
      description="Adds one spending per tax in the Taxes category, linked to the quarter it pays for, so the declaration shows it as paid."
    >
      <TaxPaymentForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

type Lines = Record<TaxKind, { checked: boolean; amount: string }>;

const SHOWN = ["date", "accountId", "period", "note", "line.single_tax", "line.military_levy", "line.esv"] as const;

function TaxPaymentForm({
  quarters,
  defaultPeriod,
  accounts,
  defaultAccountId,
  today,
  optionalEsv,
  onDone,
}: Omit<RecordTaxPaymentDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  function draftsFor(period: string): Lines {
    const o = quarters.find((q) => q.period === period);
    const line = (k: TaxKind) => {
      const outstanding = o?.items[k].outstanding ?? 0;
      return { checked: outstanding > 0, amount: outstanding > 0 ? moneyToInput(outstanding) : "" };
    };
    return { single_tax: line("single_tax"), military_levy: line("military_levy"), esv: line("esv") };
  }

  const initialPeriod =
    defaultPeriod && quarters.some((q) => q.period === defaultPeriod) ? defaultPeriod : (defaultPaymentPeriod(quarters) ?? "");
  const [period, setPeriod] = useState<string>(initialPeriod);
  const [date, setDate] = useState<ISODate>(today);
  const [accountId, setAccountId] = useState(
    accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : (accounts[0]?.id ?? ""),
  );
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Lines>(() => draftsFor(initialPeriod));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const option = quarters.find((q) => q.period === period);
  // No own ЄСВ due or paid for the quarter (e.g. an employer pays it): leave out the empty ЄСВ line —
  // unless the optional ЄСВ is included ("Include ЄСВ"), then it is offered unchecked.
  const optionalAmount = optionalEsv?.[period] ?? 0;
  const esvNotOwed = !!option && option.items.esv.due === 0 && option.items.esv.paid === 0;
  const showEsv = !option || !esvNotOwed || lines.esv.checked || optionalAmount > 0;
  const levyNote = levyPaymentNote(date);
  const lineInputs = TAX_KINDS.map((k) => ({ kind: k, ...lines[k] }));
  const preview = buildPaymentLines(lineInputs, parseMoneyInput);
  const total = sumMoney(preview.payments.map((p) => p.amount));

  function changePeriod(next: string) {
    setPeriod(next);
    setLines(draftsFor(next));
    setErrors({});
    setFormError(null);
  }

  function updateLine(kind: TaxKind, patch: Partial<Lines[TaxKind]>) {
    setLines((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
    setErrors((e) => clearFieldErrors(e, `line.${kind}`));
  }

  function submit() {
    const built = buildPaymentLines(lineInputs, parseMoneyInput);
    const next: FieldErrors = {};
    for (const [kind, message] of Object.entries(built.errors)) next[`line.${kind}`] = [message];
    if (!period) next.period = ["Choose the quarter this payment is for"];
    if (!accountId) next.accountId = ["Choose the UAH account you paid from"];
    setErrors(next);
    setFormError(built.formError);
    if (Object.keys(next).length || built.formError) return;

    const input: TaxPaymentInput = { date, accountId, period, payments: built.payments, note: note.trim() || null };
    startTransition(async () => {
      const res = await recordTaxPayment(input);
      if (res.ok) {
        const sum = sumMoney(res.data.map((e) => e.amount));
        toast.success(
          `Recorded ${res.data.length} payment${res.data.length === 1 ? "" : "s"} for ${formatQuarter(period)} — ${formatMoney(sum, "UAH")}`,
        );
        onDone();
        return;
      }
      // Map "payments.<i>.<field>" back to the tax kind of the i-th submitted line.
      const mapped: FieldErrors = {};
      for (const [key, messages] of Object.entries(res.fieldErrors ?? {})) {
        const m = /^payments\.(\d+)\./.exec(key);
        const kind = m ? built.payments[Number(m[1])]?.kind : undefined;
        mapped[kind ? `line.${kind}` : key] = messages;
      }
      setErrors(mapped);
      setFormError(unmappedError(res.error, mapped, SHOWN));
      toast.error(res.error);
    });
  }

  const noAccounts = accounts.length === 0;

  return (
    <DialogForm
      onSubmit={submit}
      footer={
        <DialogFormFooter pending={pending} submitLabel="Record payment" submitDisabled={noAccounts || quarters.length === 0}>
          {preview.payments.length ? (
            <span>
              Total <Money amount={total} currency="UAH" className="font-medium text-foreground" />
            </span>
          ) : null}
        </DialogFormFooter>
      }
    >
      <FormAlert message={noAccounts ? "Add a UAH account first — tax payments are made from a UAH account." : formError} />
      <FieldGroup className="gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errorOf(errors, "period") || undefined}>
            <FieldLabel htmlFor="tax-pay-period">For the period</FieldLabel>
            <Select value={period} onValueChange={changePeriod}>
              <SelectTrigger id="tax-pay-period" className="w-full" aria-invalid={!!errorOf(errors, "period") || undefined}>
                <SelectValue placeholder="Choose a quarter" />
              </SelectTrigger>
              <SelectContent position="popper">
                {quarters.map((q) => (
                  <SelectItem key={q.period} value={q.period}>
                    {q.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError>{errorOf(errors, "period")}</FieldError>
          </Field>
          <Field data-invalid={!!errorOf(errors, "date") || undefined}>
            <FieldLabel htmlFor="tax-pay-date">Payment date</FieldLabel>
            <DatePicker id="tax-pay-date" value={date} onChange={setDate} today={today} max={today} invalid={!!errorOf(errors, "date")} />
            <FieldError>{errorOf(errors, "date")}</FieldError>
          </Field>
        </div>

        <Field data-invalid={!!errorOf(errors, "accountId") || undefined}>
          <FieldLabel htmlFor="tax-pay-account">Paid from</FieldLabel>
          <AccountSelect
            id="tax-pay-account"
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            invalid={!!errorOf(errors, "accountId")}
            placeholder={noAccounts ? "No UAH accounts" : "Choose a UAH account"}
          />
          <FieldError>{errorOf(errors, "accountId")}</FieldError>
        </Field>

        <FieldSet className="gap-2">
          <FieldLegend variant="label">Payments</FieldLegend>
          <FieldDescription className="text-xs">
            Prefilled with what is still outstanding for {period ? formatQuarter(period) : "the quarter"}. Single tax and military
            levy are separate payments.
          </FieldDescription>
          <div className="divide-y rounded-lg border">
            {TAX_KINDS.filter((k) => k !== "esv" || showEsv).map((k) => {
              const item = option?.items[k];
              const deadline = k === "esv" ? option?.esvDeadline : option?.paymentDeadline;
              const err = errorOf(errors, `line.${k}`);
              const id = `tax-pay-${k}`;
              return (
                <div
                  key={k}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 p-3 sm:grid-cols-[auto_minmax(0,1fr)_10rem]",
                    lines[k].checked && "bg-primary/5",
                  )}
                >
                  <Checkbox
                    id={id}
                    checked={lines[k].checked}
                    onCheckedChange={(v) =>
                      updateLine(k, {
                        checked: v === true,
                        // Ticking the optional ЄСВ prefills the minimum for the quarter.
                        ...(k === "esv" && v === true && esvNotOwed && optionalAmount > 0 && !lines.esv.amount.trim()
                          ? { amount: moneyToInput(optionalAmount) }
                          : {}),
                      })
                    }
                    className="mt-0.5"
                  />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Label htmlFor={id} className="font-medium">
                      {TAX_KIND_LABELS[k]}
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {item
                        ? item.due > 0
                          ? `Due ${formatMoney(item.due, "UAH")} · paid ${formatMoney(item.paid, "UAH")}`
                          : item.paid > 0
                            ? `Paid ${formatMoney(item.paid, "UAH")} · nothing due`
                            : k === "esv" && optionalAmount > 0
                              ? `Optional — not owed · minimum ${formatMoney(optionalAmount, "UAH")} for the quarter`
                              : "Nothing due"
                        : null}
                      {deadline ? ` · by ${formatDate(deadline)}` : null}
                    </span>
                    {k === "military_levy" && levyNote ? <span className="text-xs text-muted-foreground">{levyNote}</span> : null}
                  </div>
                  <div className="col-start-2 flex flex-col gap-1 sm:col-start-auto">
                    <MoneyInput
                      id={`${id}-amount`}
                      aria-label={`${TAX_KIND_LABELS[k]} amount`}
                      value={lines[k].amount}
                      onChange={(v) => updateLine(k, { amount: v, ...(v.trim() ? { checked: true } : {}) })}
                      currency="UAH"
                      invalid={!!err}
                    />
                    {err ? <FieldError>{err}</FieldError> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </FieldSet>

        <Field data-invalid={!!errorOf(errors, "note") || undefined}>
          <FieldLabel htmlFor="tax-pay-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input
            id="tax-pay-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder={period ? `Default: “<tax> — ${formatQuarter(period)}” on each payment` : undefined}
          />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
