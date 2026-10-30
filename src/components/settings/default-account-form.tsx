"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountSelect } from "@/components/forms/form-kit";
import { Money } from "@/components/shared/money";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import type { Account } from "@/lib/types";
import { updateSettings } from "@/server/actions/settings";

export interface DefaultAccountFormProps {
  /** Eligible accounts: UAH, group "active", not archived. */
  accounts: Account[];
  /** Saved `settings.defaultActiveAccountId`. */
  value: string;
  /** Current balance per account id (account currency). */
  balances: Record<string, number>;
}

/** Pick the main bank account; saved immediately with `updateSettings({ defaultActiveAccountId })`. */
export function DefaultAccountForm({ accounts, value, balances }: DefaultAccountFormProps) {
  const [selected, setSelected] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (value !== prevValue) {
    // The server copy changed (saved here or elsewhere) — follow it.
    setPrevValue(value);
    setSelected(value);
  }

  function change(id: string) {
    if (id === selected) return;
    const account = accounts.find((a) => a.id === id);
    setSelected(id);
    setError(null);
    startTransition(async () => {
      const res = await updateSettings({ defaultActiveAccountId: id });
      if (res.ok) {
        toast.success(`Main account: ${account?.name ?? "updated"}`);
        return;
      }
      setSelected(value);
      const message = res.fieldErrors?.defaultActiveAccountId?.[0] ?? res.error;
      setError(message);
      toast.error(res.error);
    });
  }

  const balance = balances[selected];
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor="default-account">Account</FieldLabel>
      <div className="flex items-center gap-2">
        <AccountSelect
          id="default-account"
          accounts={accounts}
          value={selected}
          onChange={change}
          disabled={pending || accounts.length === 0}
          grouped={false}
          invalid={!!error}
          className="sm:w-80"
        />
        {pending ? <Spinner className="text-muted-foreground" aria-label="Saving" /> : null}
      </div>
      {balance !== undefined ? (
        <FieldDescription className="text-xs">
          Current balance: <Money amount={balance} currency="UAH" className="text-foreground" />
        </FieldDescription>
      ) : null}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
