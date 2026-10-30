"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ACCOUNT_GROUP_ICONS } from "@/components/shared/account-label";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseMoneyInput } from "@/lib/money";
import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type Account, type AccountGroup, type AccountInput, type Currency, type FieldErrors } from "@/lib/types";
import { createAccount, updateAccount } from "@/server/actions/accounts";
import {
  CurrencyToggle,
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  MoneyInput,
  errorOf,
  moneyToInput,
  unmappedError,
  useControllableOpen,
  type DialogControlProps,
} from "./form-kit";

const GROUP_HINTS: Record<AccountGroup, string> = {
  active: "Your main spending money (UAH only). Counts as the Active balance.",
  freelancer: "ФОП accounts that receive freelance income. Part of the Frozen balance.",
  ibkr: "Investments — IBKR or any other brokerage. Track deposits and value on the Investments page. Part of the Frozen balance.",
  deposits: "Term deposits and savings. Track top-ups and interest on the Investments page. Part of the Frozen balance.",
  other: "Anything else — cash, other banks. Part of the Frozen balance.",
};

export interface AccountDialogProps extends DialogControlProps {
  /** Edit mode. */
  account?: Account;
  /** Disable the currency switch (the account already has records — `usage.total > 0`). */
  currencyLocked?: boolean;
  /** Create-mode defaults. */
  defaults?: { group?: AccountGroup; currency?: Currency; name?: string };
  onSaved?: (account: Account) => void;
}

/** Create / edit an account (group, currency — Active must be UAH — opening balance). */
export function AccountDialog({ open, onOpenChange, trigger, ...rest }: AccountDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  return (
    <FormDialog open={isOpen} onOpenChange={setOpen} trigger={trigger} title={rest.account ? "Edit account" : "New account"}>
      <AccountForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

const SHOWN = ["name", "group", "currency", "openingBalance", "note"] as const;

function AccountForm({ account, currencyLocked, defaults, onSaved, onDone }: Omit<AccountDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const [name, setName] = useState(account?.name ?? defaults?.name ?? "");
  const [group, setGroup] = useState<AccountGroup>(account?.group ?? defaults?.group ?? "other");
  const [currency, setCurrency] = useState<Currency>(account?.currency ?? (defaults?.group === "active" ? "UAH" : (defaults?.currency ?? "UAH")));
  const [opening, setOpening] = useState(account ? moneyToInput(account.openingBalance) : "");
  const [note, setNote] = useState(account?.note ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function changeGroup(next: AccountGroup) {
    setGroup(next);
    if (next === "active" && !currencyLocked) setCurrency("UAH");
  }

  function submit() {
    const parsedOpening = opening.trim() === "" ? 0 : parseMoneyInput(opening);
    const next: FieldErrors = {};
    if (!name.trim()) next.name = ["Enter a name"];
    if (parsedOpening === null) next.openingBalance = ["Enter a valid amount (at most 2 decimals; may be negative)"];
    if (group === "active" && currency !== "UAH") next.currency = ["Accounts in the Active group must be in UAH"];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    const input: AccountInput = { name: name.trim(), group, currency, openingBalance: parsedOpening!, note: note.trim() || null };
    startTransition(async () => {
      const res = account ? await updateAccount(account.id, input) : await createAccount(input);
      if (res.ok) {
        toast.success(account ? "Account updated" : "Account created");
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
    <DialogForm onSubmit={submit} footer={<DialogFormFooter pending={pending} submitLabel={account ? "Save changes" : "Create account"} />}>
      <FormAlert message={formError} />
      <FieldGroup className="gap-4">
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="account-name">Name</FieldLabel>
          <Input id="account-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Monobank black" aria-invalid={!!errors.name || undefined} />
          <FieldError>{errorOf(errors, "name")}</FieldError>
        </Field>
        <Field data-invalid={!!errors.group || undefined}>
          <FieldLabel htmlFor="account-group">Group</FieldLabel>
          <Select value={group} onValueChange={(v) => changeGroup(v as AccountGroup)}>
            <SelectTrigger id="account-group" className="w-full" aria-invalid={!!errors.group || undefined}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {ACCOUNT_GROUPS.map((g) => {
                const Icon = ACCOUNT_GROUP_ICONS[g];
                return (
                  <SelectItem key={g} value={g}>
                    <Icon className="text-muted-foreground" /> {ACCOUNT_GROUP_LABELS[g]}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <FieldDescription className="text-xs">{GROUP_HINTS[group]}</FieldDescription>
          <FieldError>{errorOf(errors, "group")}</FieldError>
        </Field>
        <Field data-invalid={!!errors.currency || undefined}>
          <FieldLabel htmlFor="account-currency">Currency</FieldLabel>
          <CurrencyToggle
            id="account-currency"
            value={currency}
            onChange={setCurrency}
            options={["UAH", "USD", "EUR", "PLN"]}
            disabled={currencyLocked || group === "active"}
          />
          {currencyLocked ? (
            <FieldDescription className="text-xs">The currency can&apos;t change once the account has records.</FieldDescription>
          ) : group === "active" ? (
            <FieldDescription className="text-xs">Active accounts are always UAH.</FieldDescription>
          ) : null}
          <FieldError>{errorOf(errors, "currency")}</FieldError>
        </Field>
        <Field data-invalid={!!errors.openingBalance || undefined}>
          <FieldLabel htmlFor="account-opening">Opening balance</FieldLabel>
          <MoneyInput id="account-opening" value={opening} onChange={setOpening} currency={currency} invalid={!!errors.openingBalance} />
          <FieldDescription className="text-xs">What the account held before you started tracking it here.</FieldDescription>
          <FieldError>{errorOf(errors, "openingBalance")}</FieldError>
        </Field>
        <Field data-invalid={!!errors.note || undefined}>
          <FieldLabel htmlFor="account-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input id="account-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <FieldError>{errorOf(errors, "note")}</FieldError>
        </Field>
      </FieldGroup>
    </DialogForm>
  );
}
