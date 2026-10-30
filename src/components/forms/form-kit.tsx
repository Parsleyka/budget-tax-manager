"use client";

import { CircleAlert } from "lucide-react";
import type * as React from "react";
import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { AccountLabel } from "@/components/shared/account-label";
import { CategoryBadge } from "@/components/shared/category-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { splitPinned } from "@/lib/categories";
import { CURRENCY_SYMBOL, amountInputEdit, formatAmountTyping } from "@/lib/money";
import { ACCOUNT_GROUPS, ACCOUNT_GROUP_LABELS, type Account, type Category, type Currency, type FieldErrors } from "@/lib/types";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ dialog plumbing

/** Every form dialog supports controlled open state AND/OR a trigger element. */
export interface DialogControlProps {
  /** Controlled open state. Omit (with `trigger`) for an uncontrolled dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog, rendered with `asChild` (e.g. `<Button>Add spending</Button>`). */
  trigger?: React.ReactElement;
}

export function useControllableOpen(open: boolean | undefined, onOpenChange?: (open: boolean) => void) {
  const [inner, setInner] = useState(false);
  const value = open ?? inner;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  };
  return [value, setOpen] as const;
}

export interface FormDialogProps extends DialogControlProps {
  title: React.ReactNode;
  /** Screen-reader description (not shown). */
  description?: React.ReactNode;
  /** The form. It is mounted only while the dialog is open, so every open starts from fresh defaults. */
  children: React.ReactNode;
  /** Wider dialog for forms with side-by-side fields. Default "md". */
  size?: "sm" | "md" | "lg";
  /** Ignore close requests (Esc / outside click / ✕) while saving. Forms using DialogFormFooter report it automatically. */
  busy?: boolean;
}

/** Lets the form inside a FormDialog report "saving…" (DialogFormFooter does it from its `pending`). */
const FormBusyContext = createContext<((busy: boolean) => void) | null>(null);

/** Dialog shell used by every form dialog: header + scrollable body + sticky footer, ≤ viewport height. */
export function FormDialog({ open, onOpenChange, trigger, title, description, children, size = "md", busy }: FormDialogProps) {
  const [saving, setSaving] = useState(false);
  // While a save is in flight, Esc / an outside click / ✕ must not unmount the form: the server may
  // still answer with field errors, and the typed input would be lost.
  const blocked = saving || !!busy;
  return (
    <Dialog open={open} onOpenChange={(o) => (blocked && !o ? undefined : onOpenChange?.(o))}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0",
          size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-xl" : "sm:max-w-md",
        )}
        showCloseButton={!blocked}
        aria-busy={blocked || undefined}
        onEscapeKeyDown={(e) => {
          if (blocked) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (blocked) e.preventDefault();
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-1">
          <DialogTitle className="text-base">{title}</DialogTitle>
          {/* Minimal UI: the description is for screen readers only; the fields speak for themselves. */}
          <DialogDescription className="sr-only">{description ?? title}</DialogDescription>
        </DialogHeader>
        <FormBusyContext.Provider value={setSaving}>{children}</FormBusyContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

/** Report a form's pending state to the enclosing FormDialog (no-op outside one). */
export function useReportFormBusy(pending: boolean) {
  const report = useContext(FormBusyContext);
  // Layout effect: the dialog must know before the next key press (Esc right after Enter).
  useLayoutEffect(() => {
    report?.(pending);
    return () => report?.(false);
  }, [pending, report]);
}

/** `<form>` laid out for FormDialog: scrollable fields + footer. */
export function DialogForm({
  onSubmit,
  children,
  footer,
}: {
  onSubmit: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">{children}</div>
      {footer}
    </form>
  );
}

/** Cancel + submit buttons with a pending spinner. */
export function DialogFormFooter({
  pending,
  submitLabel = "Save",
  submitDisabled,
  children,
}: {
  pending: boolean;
  submitLabel?: string;
  submitDisabled?: boolean;
  /** Extra content on the left (e.g. a summary); on phones it is a line above the buttons. */
  children?: React.ReactNode;
}) {
  useReportFormBusy(pending);
  return (
    <DialogFooter className="mx-0 mb-0 items-center px-5 py-3 sm:justify-between">
      {children ? (
        // The footer is `flex-col-reverse` on phones: `order-last` puts the summary ABOVE the buttons there.
        <div className="order-last w-full min-w-0 text-xs text-muted-foreground sm:order-none sm:w-auto" data-testid="dialog-footer-summary">
          {children}
        </div>
      ) : (
        <div className="hidden sm:block" />
      )}
      <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || submitDisabled}>
          {pending ? <Spinner /> : null}
          {submitLabel}
        </Button>
      </div>
    </DialogFooter>
  );
}

// ------------------------------------------------------------------ errors

/** First error message for a field key (zod path joined with "."). */
export function errorOf(errors: FieldErrors, key: string): string | undefined {
  return errors[key]?.[0];
}

/**
 * Remove the errors of `keys` (e.g. after the user changed those fields). Keys are DELETED, never set
 * to `[]`: forms test `!!errors.x`, and an empty array is truthy — it would paint the field red.
 */
export function clearFieldErrors(errors: FieldErrors, ...keys: string[]): FieldErrors {
  if (!keys.some((k) => k in errors)) return errors;
  const next = { ...errors };
  for (const k of keys) delete next[k];
  return next;
}

/** Root-level / unmapped server error shown above the fields. */
export function FormAlert({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" className="mb-4">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/**
 * Message for the top-of-form alert: the root error ("_") or, when the server error has no field
 * that this form shows, the general error text.
 */
export function unmappedError(error: string, fieldErrors: FieldErrors | undefined, shownKeys: readonly string[]): string | null {
  if (!fieldErrors) return error;
  if (fieldErrors._?.[0]) return fieldErrors._[0];
  return Object.keys(fieldErrors).some((k) => shownKeys.includes(k)) ? null : error;
}

// ------------------------------------------------------------------ inputs

export interface MoneyInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
  value: string;
  onChange: (value: string) => void;
  /** Shows the symbol as a suffix. */
  currency?: Currency;
  invalid?: boolean;
}

/**
 * Decimal text input with a currency suffix. Digits are grouped by thousands while typing
 * ("100000" → "100 000") with the caret kept next to the same digit. Parse with `parseMoneyInput`.
 */
export function MoneyInput({ value, onChange, currency, invalid, className, ...props }: MoneyInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <InputGroup className={className}>
      <InputGroupInput
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        className="tabular-nums"
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => {
          const el = e.target;
          const inputType = (e.nativeEvent as InputEvent).inputType;
          const next = amountInputEdit(value, el.value, el.selectionStart ?? el.value.length, inputType);
          onChange(next.text);
          // After React writes the (regrouped) value back to the DOM, put the caret where it belongs.
          queueMicrotask(() => {
            if (ref.current && document.activeElement === ref.current) ref.current.setSelectionRange(next.caret, next.caret);
          });
        }}
        {...props}
      />
      {currency ? (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs">{CURRENCY_SYMBOL[currency]}</InputGroupText>
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
}

/**
 * Error text for an amount that did not parse. "58.500" / "58,500" get a specific hint (they look
 * like a thousands separator, which is ambiguous); anything else gets `fallback`.
 */
export function invalidAmountMessage(text: string, fallback = "Enter an amount greater than 0 (at most 2 decimals)"): string {
  return /^\s*-?\d{1,3}[.,]\d{3}\s*$/.test(text)
    ? "Ambiguous amount — use a space for thousands and a comma for kopecks (e.g. 58 500 or 58 500,00)"
    : fallback;
}

/** Money value → input text ("1234.5" → "1 234,50"); empty for null/undefined. */
export function moneyToInput(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "";
  return formatAmountTyping(amount.toFixed(2).replace(".", ","));
}

/** Rate → input text (4 decimals max, comma). */
export function rateToInput(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "";
  return String(rate).replace(".", ",");
}

export interface AccountSelectProps {
  id?: string;
  accounts: readonly Account[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Group items under "Active / Freelancer / …" labels (default true when > 4 accounts). */
  grouped?: boolean;
  className?: string;
}

/** Account picker: group icon + name + currency badge, grouped by account group. */
export function AccountSelect({ id, accounts, value, onChange, invalid, disabled, placeholder = "Choose an account", grouped, className }: AccountSelectProps) {
  const useGroups = grouped ?? accounts.length > 4;
  const groups = ACCOUNT_GROUPS.map((g) => ({ g, items: accounts.filter((a) => a.group === g) })).filter((x) => x.items.length);
  return (
    // Always controlled: "" shows the placeholder. (`value || undefined` made Radix fall back to its
    // stale internal value, e.g. after "Swap accounts" cleared a field.)
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {accounts.length === 0 ? <div className="px-2 py-3 text-sm text-muted-foreground">No matching accounts</div> : null}
        {useGroups
          ? groups.map(({ g, items }) => (
              <SelectGroup key={g}>
                <SelectLabel>{ACCOUNT_GROUP_LABELS[g]}</SelectLabel>
                {items.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <AccountLabel account={a} />
                  </SelectItem>
                ))}
              </SelectGroup>
            ))
          : accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <AccountLabel account={a} />
              </SelectItem>
            ))}
      </SelectContent>
    </Select>
  );
}

export interface CategorySelectProps {
  id?: string;
  categories: readonly Category[];
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** Category picker with color dot + icon. Pinned categories (Settings → Categories) come first, in their own group. */
export function CategorySelect({ id, categories, value, onChange, invalid, disabled, placeholder = "Choose a category", className }: CategorySelectProps) {
  const { pinned, others } = splitPinned(categories);
  const item = (c: Category) => (
    <SelectItem key={c.id} value={c.id}>
      <CategoryBadge category={c} variant="inline" />
    </SelectItem>
  );
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn("w-full", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {pinned.length && others.length ? (
          <>
            <SelectGroup>
              <SelectLabel>Pinned</SelectLabel>
              {pinned.map(item)}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>All categories</SelectLabel>
              {others.map(item)}
            </SelectGroup>
          </>
        ) : (
          categories.map(item)
        )}
      </SelectContent>
    </Select>
  );
}

export interface CurrencyToggleProps {
  id?: string;
  value: Currency;
  onChange: (currency: Currency) => void;
  options?: readonly Currency[];
  disabled?: boolean;
  className?: string;
}

/** Segmented USD / EUR / UAH switch. */
export function CurrencyToggle({ id, value, onChange, options = ["USD", "EUR", "PLN", "UAH"], disabled, className }: CurrencyToggleProps) {
  return (
    <ToggleGroup
      id={id}
      type="single"
      variant="outline"
      spacing={0}
      value={value}
      onValueChange={(v) => v && onChange(v as Currency)}
      disabled={disabled}
      className={className}
      aria-label="Currency"
    >
      {options.map((c) => (
        <ToggleGroupItem key={c} value={c} className="min-w-14 px-3 font-medium data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground" aria-label={c}>
          {c} <span className="text-xs opacity-70">{CURRENCY_SYMBOL[c]}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** Keep the record's current (possibly archived) account/category selectable when editing. */
export function withCurrent<T extends { id: string }>(items: readonly T[], current: T | null | undefined): T[] {
  if (!current || items.some((i) => i.id === current.id)) return [...items];
  return [...items, current];
}
