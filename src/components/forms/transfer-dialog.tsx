"use client";

import { ArrowDownUp, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { Money } from "@/components/shared/money";
import { RateHint } from "@/components/shared/rate-hint";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CURRENCY_SYMBOL, convertToUah, effectiveRate, formatPercent, formatRate, parseMoneyInput, round2, round4 } from "@/lib/money";
import type { Account, Currency, FieldErrors, Transfer, TransferInput } from "@/lib/types";
import { createTransfer, updateTransfer } from "@/server/actions/transfers";
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
  moneyToInput,
  unmappedError,
  useControllableOpen,
  withCurrent,
  type DialogControlProps,
} from "./form-kit";
import { useNbuRate, type NbuRateState } from "./use-nbu-rate";

export type TransferDialogOptions = Pick<FormOptions, "today" | "accounts" | "balances">;

export interface TransferDialogProps extends DialogControlProps {
  options: TransferDialogOptions;
  /** Edit mode. Pass a `TransferRow` (carries `fromAccount`/`toAccount`) so archived accounts stay selectable. */
  transfer?: Transfer & { fromAccount?: Account | null; toAccount?: Account | null };
  /** Create-mode defaults (e.g. `{ fromAccountId: fopUsdId }` for "Sell USD"). */
  defaults?: { date?: string; fromAccountId?: string; toAccountId?: string; fromAmount?: number; note?: string };
  onSaved?: (transfer: Transfer) => void;
}

/** Move money between own accounts, incl. currency sale/purchase (to-amount prefilled at the NBU cross rate). */
export function TransferDialog({ open, onOpenChange, trigger, ...rest }: TransferDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      title={rest.transfer ? "Edit transfer" : "Transfer between accounts"}
      description={rest.transfer ? undefined : "Move money between your accounts. Different currencies = a currency sale or purchase."}
    >
      <TransferForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

const SHOWN = ["fromAccountId", "toAccountId", "fromAmount", "toAmount", "date", "note"] as const;

/** Rate usable for a prefill suggestion (stale is fine — the user can edit the amount). */
function suggestRate(currency: Currency | undefined, state: NbuRateState): number | null {
  if (!currency) return null;
  if (currency === "UAH") return 1;
  return state.status === "ok" || state.status === "stale" ? state.result.rate : null;
}

function TransferForm({ options, transfer, defaults, onSaved, onDone }: Omit<TransferDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const accounts = withCurrent(withCurrent(options.accounts, transfer?.fromAccount ?? null), transfer?.toAccount ?? null);
  const pick = (id: string | undefined) => (id && accounts.some((a) => a.id === id) ? id : "");

  const [fromId, setFromId] = useState(transfer?.fromAccountId ?? pick(defaults?.fromAccountId));
  const [toId, setToId] = useState(transfer?.toAccountId ?? pick(defaults?.toAccountId));
  const [fromText, setFromText] = useState(moneyToInput(transfer?.fromAmount ?? defaults?.fromAmount));
  const [toText, setToText] = useState(moneyToInput(transfer?.toAmount));
  const [toTouched, setToTouched] = useState(!!transfer);
  const [date, setDate] = useState(transfer?.date ?? defaults?.date ?? options.today);
  const [note, setNote] = useState(transfer?.note ?? defaults?.note ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const cross = !!from && !!to && from.currency !== to.currency;

  const fromState = useNbuRate(from?.currency ?? "UAH", date, cross);
  const toState = useNbuRate(to?.currency ?? "UAH", date, cross);
  const fromRate = suggestRate(from?.currency, fromState);
  const toRate = suggestRate(to?.currency, toState);
  const ratesLoading = cross && (fromState.status === "loading" || toState.status === "loading");

  const fromAmount = parseMoneyInput(fromText);
  const validFrom = fromAmount !== null && fromAmount > 0 ? fromAmount : null;
  let suggestion: number | null = null;
  if (cross && validFrom !== null && fromRate && toRate) {
    const uah = convertToUah(validFrom, fromRate);
    suggestion = to!.currency === "UAH" ? uah : round2(uah / toRate);
  }
  const toDisplay = !cross ? fromText : toTouched ? toText : suggestion !== null ? moneyToInput(suggestion) : "";
  const toAmount = cross ? parseMoneyInput(toDisplay) : validFrom;
  const validTo = toAmount !== null && toAmount > 0 ? toAmount : null;

  // Effective rate, oriented as "UAH per foreign unit" (or "to per from" for USD↔EUR).
  let rateLine: { label: string; value: number; nbu: number | null } | null = null;
  if (cross && validFrom !== null && validTo !== null) {
    if (to!.currency === "UAH") {
      rateLine = { label: `1 ${CURRENCY_SYMBOL[from!.currency]} =`, value: effectiveRate(validFrom, validTo), nbu: fromRate };
    } else if (from!.currency === "UAH") {
      rateLine = { label: `1 ${CURRENCY_SYMBOL[to!.currency]} =`, value: effectiveRate(validTo, validFrom), nbu: toRate };
    } else {
      rateLine = {
        label: `1 ${CURRENCY_SYMBOL[from!.currency]} =`,
        value: effectiveRate(validFrom, validTo),
        nbu: fromRate && toRate ? round4(fromRate / toRate) : null,
      };
    }
  }
  const rateUnit = cross && to && from ? (to.currency === "UAH" || from.currency === "UAH" ? "₴" : CURRENCY_SYMBOL[to.currency]) : "";

  function swap() {
    setFromId(toId);
    setToId(fromId);
    setToTouched(false);
  }

  function submit() {
    const next: FieldErrors = {};
    if (!fromId) next.fromAccountId = ["Choose the source account"];
    if (!toId) next.toAccountId = ["Choose the destination account"];
    else if (fromId === toId) next.toAccountId = ["Choose two different accounts"];
    if (validFrom === null) next.fromAmount = [invalidAmountMessage(fromText)];
    if (cross && validTo === null) next.toAmount = [invalidAmountMessage(toDisplay, "Enter the amount received (at most 2 decimals)")];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    const input: TransferInput = {
      date,
      fromAccountId: fromId,
      toAccountId: toId,
      fromAmount: validFrom!,
      toAmount: cross ? validTo : null,
      note: note.trim() || null,
    };
    startTransition(async () => {
      const res = transfer ? await updateTransfer(transfer.id, input) : await createTransfer(input);
      if (res.ok) {
        toast.success(transfer ? "Transfer updated" : "Transfer saved");
        onSaved?.(res.data);
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  const balance = (a: Account | undefined) =>
    a && options.balances[a.id] !== undefined ? (
      <FieldDescription className="text-xs">
        Balance: <Money amount={options.balances[a.id]} currency={a.currency} />
      </FieldDescription>
    ) : null;

  return (
    <DialogForm onSubmit={submit} footer={<DialogFormFooter pending={pending} submitLabel={transfer ? "Save changes" : "Transfer"} />}>
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.fromAccountId || undefined}>
          <FieldLabel htmlFor="transfer-from">From</FieldLabel>
          <AccountSelect id="transfer-from" accounts={accounts} value={fromId} onChange={(v) => { setFromId(v); setToTouched(false); }} invalid={!!errors.fromAccountId} />
          {balance(from)}
          <FieldError>{errorOf(errors, "fromAccountId")}</FieldError>
        </Field>
        <div className="-my-2 flex justify-center">
          <Button type="button" variant="ghost" size="icon-sm" onClick={swap} aria-label="Swap accounts" disabled={!fromId && !toId}>
            <ArrowDownUp />
          </Button>
        </div>
        <Field data-invalid={!!errors.toAccountId || undefined}>
          <FieldLabel htmlFor="transfer-to">To</FieldLabel>
          <AccountSelect
            id="transfer-to"
            accounts={accounts.filter((a) => a.id !== fromId)}
            value={toId === fromId ? "" : toId}
            onChange={(v) => { setToId(v); setToTouched(false); }}
            invalid={!!errors.toAccountId}
          />
          {balance(to)}
          <FieldError>{errorOf(errors, "toAccountId")}</FieldError>
        </Field>

        <div className={cross ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
          <Field data-invalid={!!errors.fromAmount || undefined}>
            <FieldLabel htmlFor="transfer-from-amount">{cross ? "Amount sent" : "Amount"}</FieldLabel>
            <MoneyInput id="transfer-from-amount" value={fromText} onChange={setFromText} currency={from?.currency} invalid={!!errors.fromAmount} />
            <FieldError>{errorOf(errors, "fromAmount")}</FieldError>
          </Field>
          {cross ? (
            <Field data-invalid={!!errors.toAmount || undefined}>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="transfer-to-amount">Amount received</FieldLabel>
                {toTouched && suggestion !== null ? (
                  <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setToTouched(false)}>
                    <RotateCcw /> NBU
                  </Button>
                ) : null}
              </div>
              <MoneyInput
                id="transfer-to-amount"
                value={toDisplay}
                onChange={(v) => {
                  setToTouched(true);
                  setToText(v);
                }}
                currency={to?.currency}
                invalid={!!errors.toAmount}
                placeholder={ratesLoading ? "Fetching rate…" : "0,00"}
              />
              <FieldDescription className="text-xs">
                {toTouched ? "Entered manually." : "Prefilled at the NBU rate — edit to match your bank."}
              </FieldDescription>
              <FieldError>{errorOf(errors, "toAmount")}</FieldError>
            </Field>
          ) : null}
        </div>

        {cross ? (
          <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-xs" data-slot="transfer-rate-panel">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Effective rate</span>
              <span className="text-sm font-semibold tabular-nums">
                {rateLine ? `${rateLine.label} ${formatRate(rateLine.value)} ${rateUnit}` : "—"}
              </span>
            </div>
            {rateLine?.nbu ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-muted-foreground">
                <span>NBU rate</span>
                <span className="tabular-nums">
                  {formatRate(rateLine.nbu)} {rateUnit}
                  {rateLine.value !== rateLine.nbu
                    ? ` · ${formatPercent(Math.abs(rateLine.value - rateLine.nbu) / rateLine.nbu, 2)} ${rateLine.value > rateLine.nbu ? "above" : "below"}`
                    : " · same"}
                </span>
              </div>
            ) : null}
            {from && from.currency !== "UAH" && (fromState.status === "stale" || fromState.status === "unavailable") ? (
              <RateHint currency={from.currency} rate={fromState.status === "stale" ? fromState.result.rate : null} stale date={date} effectiveDate={fromState.status === "stale" ? fromState.result.effectiveDate : null} error={fromState.status === "unavailable" ? "NBU rate unavailable — enter the received amount yourself" : null} />
            ) : null}
            {to && to.currency !== "UAH" && (toState.status === "stale" || toState.status === "unavailable") ? (
              <RateHint currency={to.currency} rate={toState.status === "stale" ? toState.result.rate : null} stale date={date} effectiveDate={toState.status === "stale" ? toState.result.effectiveDate : null} error={toState.status === "unavailable" ? "NBU rate unavailable — enter the received amount yourself" : null} />
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.date || undefined}>
            <FieldLabel htmlFor="transfer-date">Date</FieldLabel>
            <DatePicker id="transfer-date" value={date} onChange={setDate} today={options.today} max={options.today} invalid={!!errors.date} />
            <FieldError>{errorOf(errors, "date")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.note || undefined}>
            <FieldLabel htmlFor="transfer-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Sold USD" />
            <FieldError>{errorOf(errors, "note")}</FieldError>
          </Field>
        </div>
      </FieldGroup>
    </DialogForm>
  );
}
