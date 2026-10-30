"use client";

import { X } from "lucide-react";
import type * as React from "react";
import { DatePicker } from "@/components/shared/date-picker";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatDate, isValidDate, yearOf, type ISODate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** A DatePicker whose value may be empty (null), with a clear button. */
export function OptionalDatePicker({
  id,
  value,
  onChange,
  today,
  min,
  max,
  startYear,
  emptyLabel,
  clearLabel,
  invalid,
}: {
  id: string;
  value: ISODate | null;
  onChange: (value: ISODate | null) => void;
  today: ISODate;
  min?: ISODate;
  max?: ISODate;
  /** First year in the calendar's year dropdown (default: the DatePicker's). */
  startYear?: number;
  /** Placeholder shown while empty ("Not set", "Open-ended"). */
  emptyLabel: string;
  /** Accessible name of the clear button. */
  clearLabel: string;
  invalid?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <DatePicker
        id={id}
        value={value}
        onChange={onChange}
        today={today}
        min={min}
        max={max}
        startYear={startYear}
        placeholder={emptyLabel}
        invalid={invalid}
        shortcuts={false}
        className="min-w-0 flex-1 sm:w-60 sm:flex-none"
      />
      {value ? (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={clearLabel} title={clearLabel} onClick={() => onChange(null)}>
          <X />
        </Button>
      ) : null}
    </div>
  );
}

/** Decimal percent input with a "%" suffix. */
export function PercentInput({
  value,
  onChange,
  invalid,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  return (
    <InputGroup className={cn("w-32", className)}>
      <InputGroupInput
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="tabular-nums"
        aria-invalid={invalid || undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="text-xs">%</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** Label + description on the left, a Switch on the right (whole row is the label). */
export function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription className="text-xs">{description}</FieldDescription> : null}
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </Field>
  );
}

const OPEN = "open";

/**
 * Military levy end date. By law it is 31 December of the 3rd year after martial law ends, so the
 * picker offers "Open-ended" + 31 Dec of each year; a non-31-Dec stored value stays selectable.
 */
export function LevyEndSelect({
  id,
  value,
  onChange,
  today,
  invalid,
}: {
  id: string;
  value: ISODate | null;
  onChange: (value: ISODate | null) => void;
  today: ISODate;
  invalid?: boolean;
}) {
  const lastYear = yearOf(today) + 15;
  const options: ISODate[] = [];
  for (let y = 2025; y <= lastYear; y++) options.push(`${y}-12-31`);
  if (value && isValidDate(value) && !options.includes(value)) options.push(value);
  options.sort();
  return (
    <Select value={value ?? OPEN} onValueChange={(v) => onChange(v === OPEN ? null : v)}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className="w-full sm:w-60">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-72">
        <SelectItem value={OPEN}>Open-ended (not known yet)</SelectItem>
        {options.map((d) => (
          <SelectItem key={d} value={d}>
            Until {formatDate(d)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
