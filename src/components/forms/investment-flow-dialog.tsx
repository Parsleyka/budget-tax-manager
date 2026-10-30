"use client";

import { ArrowDownToLine, ArrowUpFromLine, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DatePicker } from "@/components/shared/date-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AccountLabel } from "@/components/shared/account-label";
import { CURRENCY_SYMBOL, convertToUah, parseMoneyInput, round2 } from "@/lib/money";
import type { Account, Currency, FieldErrors, InvestmentFlow, InvestmentFlowInput } from "@/lib/types";
import { addInvestmentFlow, updateInvestmentFlow } from "@/server/actions/investments";
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
  type DialogControlProps,
} from "./form-kit";
import { useNbuRate, type NbuRateState } from "./use-nbu-rate";

export interface InvestmentDialogOptions {
  today: string;
  /** Non-archived investment and bank-deposit accounts. */
  investmentAccounts: Account[];
  /** Your other non-archived accounts (deposit sources / withdrawal targets). */
  otherAccounts: Account[];
}

export interface InvestmentFlowDialogProps extends DialogControlProps {
  options: InvestmentDialogOptions;
  /** Create mode: which kind the form starts on. */
  kind?: "deposit" | "withdrawal";
  defaults?: { accountId?: string };
  /** Edit a deposit / withdrawal from outside (deposits from your accounts are transfers — edit those instead). */
  flow?: InvestmentFlow;
  onSaved?: () => void;
}

const OUTSIDE = "__outside__";
const SHOWN = ["accountId", "kind", "amount", "date", "linkedAccountId", "linkedAmount", "note"] as const;

/** Money into / out of an investment account: from one of your accounts (a transfer) or from outside. */
export function InvestmentFlowDialog({ open, onOpenChange, trigger, ...rest }: InvestmentFlowDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  return (
    <FormDialog
      open={isOpen}
      onOpenChange={setOpen}
      trigger={trigger}
      title={rest.flow ? "Edit deposit / withdrawal" : "Deposit or withdrawal"}
      description={rest.flow ? undefined : "Money you put into an investment or deposit account, or took out of it — your principal."}
    >
      <FlowForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

function rateOf(currency: Currency | undefined, state: NbuRateState): number | null {
  if (!currency) return null;
  if (currency === "UAH") return 1;
  return state.status === "ok" || state.status === "stale" ? state.result.rate : null;
}

function FlowForm({ options, kind: initialKind, defaults, flow, onSaved, onDone }: Omit<InvestmentFlowDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const invAccounts = options.investmentAccounts;
  const firstInv = invAccounts.find((a) => a.id === (flow?.accountId ?? defaults?.accountId))?.id ?? invAccounts[0]?.id ?? "";
  const [kind, setKind] = useState<"deposit" | "withdrawal">(flow?.kind ?? initialKind ?? "deposit");
  const [accountId, setAccountId] = useState(firstInv);
  const [amountText, setAmountText] = useState(moneyToInput(flow?.amount));
  const [date, setDate] = useState(flow?.date ?? options.today);
  const [linkedId, setLinkedId] = useState<string>(OUTSIDE);
  const [linkedText, setLinkedText] = useState("");
  const [linkedTouched, setLinkedTouched] = useState(false);
  const [note, setNote] = useState(flow?.note ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const account = invAccounts.find((a) => a.id === accountId) ?? (flow ? undefined : invAccounts[0]);
  const linked = linkedId === OUTSIDE ? undefined : options.otherAccounts.find((a) => a.id === linkedId);
  const cross = !!account && !!linked && account.currency !== linked.currency;
  const deposit = kind === "deposit";

  const invRate = useNbuRate(account?.currency ?? "UAH", date, cross);
  const linkedRate = useNbuRate(linked?.currency ?? "UAH", date, cross);
  const amount = parseMoneyInput(amountText);
  const validAmount = amount !== null && amount > 0 ? amount : null;
  let suggestion: number | null = null;
  const rInv = rateOf(account?.currency, invRate);
  const rLinked = rateOf(linked?.currency, linkedRate);
  if (cross && validAmount !== null && rInv && rLinked) {
    const uah = convertToUah(validAmount, rInv);
    suggestion = linked!.currency === "UAH" ? uah : round2(uah / rLinked);
  }
  const linkedDisplay = linkedTouched ? linkedText : suggestion !== null ? moneyToInput(suggestion) : "";
  const linkedAmount = parseMoneyInput(linkedDisplay);

  function submit() {
    const next: FieldErrors = {};
    if (!account) next.accountId = ["Choose an investment or deposit account"];
    if (validAmount === null) next.amount = [invalidAmountMessage(amountText)];
    if (cross && (linkedAmount === null || linkedAmount <= 0)) {
      next.linkedAmount = [`Enter the amount in ${linked!.currency} (at most 2 decimals)`];
    }
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;

    const input: InvestmentFlowInput = {
      accountId: account!.id,
      kind,
      date,
      amount: validAmount!,
      linkedAccountId: linked?.id ?? null,
      linkedAmount: cross ? linkedAmount : null,
      note: note.trim() || null,
    };
    startTransition(async () => {
      const res = flow ? await updateInvestmentFlow(flow.id, input) : await addInvestmentFlow(input);
      if (res.ok) {
        toast.success(flow ? "Saved" : deposit ? "Deposit saved" : "Withdrawal saved");
        onSaved?.();
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  if (invAccounts.length === 0) {
    return (
      <DialogForm onSubmit={onDone} footer={<DialogFormFooter pending={false} submitLabel="Close" />}>
        <p className="text-sm text-muted-foreground">Add an investment or deposit account first (Investments → Add account).</p>
      </DialogForm>
    );
  }

  return (
    <DialogForm onSubmit={submit} footer={<DialogFormFooter pending={pending} submitLabel={flow ? "Save changes" : deposit ? "Save deposit" : "Save withdrawal"} />}>
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="inv-kind">Type</FieldLabel>
          <ToggleGroup
            id="inv-kind"
            type="single"
            variant="outline"
            spacing={0}
            value={kind}
            onValueChange={(v) => v && setKind(v as "deposit" | "withdrawal")}
            aria-label="Deposit or withdrawal"
            className="w-full"
          >
            <ToggleGroupItem value="deposit" className="flex-1 gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground">
              <ArrowDownToLine aria-hidden /> Deposit
            </ToggleGroupItem>
            <ToggleGroupItem value="withdrawal" className="flex-1 gap-1.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground">
              <ArrowUpFromLine aria-hidden /> Withdrawal
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.accountId || undefined}>
            <FieldLabel htmlFor="inv-account">Account</FieldLabel>
            <AccountSelect
              id="inv-account"
              accounts={invAccounts}
              value={account?.id ?? ""}
              onChange={setAccountId}
              grouped={new Set(invAccounts.map((a) => a.group)).size > 1}
              invalid={!!errors.accountId}
            />
            <FieldError>{errorOf(errors, "accountId")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.amount || undefined}>
            <FieldLabel htmlFor="inv-amount">Amount</FieldLabel>
            <MoneyInput id="inv-amount" value={amountText} onChange={setAmountText} currency={account?.currency} invalid={!!errors.amount} />
            <FieldError>{errorOf(errors, "amount")}</FieldError>
          </Field>
        </div>

        <Field data-invalid={!!errors.linkedAccountId || undefined}>
          <FieldLabel htmlFor="inv-linked">{deposit ? "Money came from" : "Money went to"}</FieldLabel>
          <Select
            value={linkedId}
            onValueChange={(v) => {
              setLinkedId(v);
              setLinkedTouched(false);
            }}
            disabled={!!flow}
          >
            <SelectTrigger id="inv-linked" className="w-full" aria-invalid={!!errors.linkedAccountId || undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-80">
              <SelectItem value={OUTSIDE}>Outside — not one of my accounts</SelectItem>
              {options.otherAccounts.length ? <SelectSeparator /> : null}
              {options.otherAccounts.length ? (
                <SelectGroup>
                  <SelectLabel>My accounts</SelectLabel>
                  {options.otherAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <AccountLabel account={a} />
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
          <FieldDescription className="text-xs">
            {flow
              ? "Outside money. To move it from one of your accounts, delete this and add a new deposit from that account."
              : linked
                ? `Saved as a transfer: ${deposit ? `${linked.name} goes down` : `${linked.name} goes up`} by this amount.`
                : "e.g. deposits made before you started tracking — no other balance changes."}
          </FieldDescription>
          <FieldError>{errorOf(errors, "linkedAccountId")}</FieldError>
        </Field>

        {cross ? (
          <Field data-invalid={!!errors.linkedAmount || undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="inv-linked-amount">
                {deposit ? `Amount that left ${linked!.name}` : `Amount that arrived in ${linked!.name}`}
              </FieldLabel>
              {linkedTouched && suggestion !== null ? (
                <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setLinkedTouched(false)}>
                  <RotateCcw /> NBU
                </Button>
              ) : null}
            </div>
            <MoneyInput
              id="inv-linked-amount"
              value={linkedDisplay}
              onChange={(v) => {
                setLinkedTouched(true);
                setLinkedText(v);
              }}
              currency={linked!.currency}
              invalid={!!errors.linkedAmount}
              placeholder={invRate.status === "loading" || linkedRate.status === "loading" ? "Fetching rate…" : "0,00"}
            />
            <FieldDescription className="text-xs">
              {linkedTouched ? "Entered manually." : `Prefilled at the NBU rate (${CURRENCY_SYMBOL[account!.currency]} → ${CURRENCY_SYMBOL[linked!.currency]}) — edit to match your bank.`}
            </FieldDescription>
            <FieldError>{errorOf(errors, "linkedAmount")}</FieldError>
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.date || undefined}>
            <FieldLabel htmlFor="inv-date">Date</FieldLabel>
            <DatePicker id="inv-date" value={date} onChange={setDate} today={options.today} max={options.today} invalid={!!errors.date} />
            <FieldError>{errorOf(errors, "date")}</FieldError>
          </Field>
          <Field data-invalid={!!errors.note || undefined}>
            <FieldLabel htmlFor="inv-note">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input id="inv-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Monthly top-up" />
            <FieldError>{errorOf(errors, "note")}</FieldError>
          </Field>
        </div>
      </FieldGroup>
    </DialogForm>
  );
}
