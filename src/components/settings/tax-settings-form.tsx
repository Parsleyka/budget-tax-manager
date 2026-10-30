"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { FormAlert, MoneyInput, unmappedError } from "@/components/forms/form-kit";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { formatDate, formatMonth, monthOf, yearOf, type ISODate } from "@/lib/dates";
import { ESV_MODE_LABELS } from "@/lib/labels";
import { formatMoney, pctToBp } from "@/lib/money";
import { esvForMonth } from "@/lib/tax/engine";
import { MILITARY_LEVY_RATE_BP, MILITARY_LEVY_START, maxEsvBase, minimumEsv, minimumWage, singleTaxRateBp } from "@/lib/tax/rules";
import type { EsvMode, FieldErrors, TaxSettings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { updateSettings } from "@/server/actions/settings";
import { Disclosure } from "./disclosure";
import { EsvMonthEditor } from "./esv-month-editor";
import { LevyEndSelect, OptionalDatePicker, PercentInput, SwitchField } from "./fields";
import {
  TAX_FIELD_KEYS as K,
  draftFromTax,
  exemptPeriodKey,
  previewTaxFromDraft,
  sameTax,
  taxFromDraft,
  toggleMonth,
  type ExemptPeriodDraft,
  type TaxDraft,
} from "./tax-form-model";

const ESV_MODES: readonly EsvMode[] = ["employed", "minimum", "custom", "exempt"];
const SHOWN_KEYS: readonly string[] = Object.values(K);
const isShownKey = (key: string) => SHOWN_KEYS.includes(key) || key.startsWith(`${K.esvExemptPeriods}.`);

const pctFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });
/** 500 bp → "5%", 450 → "4,5%". */
const formatBp = (bp: number) => `${pctFormat.format(bp / 100)}%`;

function withoutKeys(errors: FieldErrors, keys: readonly string[]): FieldErrors {
  if (!keys.some((k) => errors[k])) return errors;
  const next = { ...errors };
  for (const k of keys) delete next[k];
  return next;
}

export interface TaxSettingsFormProps {
  /** Saved tax settings (the page remounts the form when they change on the server). */
  tax: TaxSettings;
  /** Today (Kyiv) from the loader. */
  today: ISODate;
}

/**
 * Settings → Taxes: ФОП registration + single tax, military levy and ЄСВ, edited as one draft and
 * saved with `updateSettings({ tax })`. Every preview (rates in effect, ЄСВ per month) follows the
 * unsaved draft.
 */
/** Registration / employment dates can be long before the app's 2024 rule tables. */
const EARLIEST_DATE_YEAR = 1995;

export function TaxSettingsForm({ tax, today }: TaxSettingsFormProps) {
  const [draft, setDraft] = useState<TaxDraft>(() => draftFromTax(tax));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const strict = useMemo(() => taxFromDraft(draft), [draft]);
  const preview = useMemo(() => previewTaxFromDraft(draft, tax), [draft, tax]);
  const dirty = !strict.ok || !sameTax(strict.tax, tax);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update<F extends keyof TaxDraft>(field: F, value: TaxDraft[F], clear: readonly string[] = []) {
    setDraft((d) => ({ ...d, [field]: value }));
    if (clear.length) setErrors((e) => withoutKeys(e, clear));
  }

  function reset() {
    setDraft(draftFromTax(tax));
    setErrors({});
    setFormError(null);
  }

  function save() {
    const result = taxFromDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setFormError(null);
      toast.error("Please fix the highlighted fields.");
      return;
    }
    startTransition(async () => {
      const res = await updateSettings({ tax: result.tax });
      if (res.ok) {
        setErrors({});
        setFormError(null);
        toast.success("Tax settings saved");
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, Object.keys(res.fieldErrors ?? {}).filter(isShownKey)));
      toast.error(res.error);
    });
  }

  const err = (key: string) => errors[key]?.[0];
  const month = monthOf(today);
  const singleBp = singleTaxRateBp(preview);
  const levyBp = preview.militaryLevyRateOverridePct !== null ? pctToBp(preview.militaryLevyRateOverridePct) : MILITARY_LEVY_RATE_BP;
  const esvNow = esvForMonth(month, preview);
  const minEsvNow = minimumEsv(month);

  const summary = (
    <>
      Single tax {formatBp(singleBp)} · Levy{" "}
      {preview.militaryLevyEnabled ? `${formatBp(levyBp)}${preview.militaryLevyEndDate ? ` until ${formatDate(preview.militaryLevyEndDate)}` : ""}` : "off"} · ЄСВ{" "}
      {formatMonth(month)}: {formatMoney(esvNow.amount, "UAH")}
    </>
  );

  return (
    <form
      noValidate
      aria-label="Tax settings"
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {formError ? <FormAlert message={formError} /> : null}

      {/* ------------------------------------------------ ФОП: registration, VAT, military levy */}
      <SectionCard title="ФОП">
        <FieldGroup className="gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!err(K.fopRegisteredOn) || undefined}>
              <FieldLabel htmlFor="fop-registered-on">Registered on</FieldLabel>
              <OptionalDatePicker
                id="fop-registered-on"
                startYear={EARLIEST_DATE_YEAR}
                value={draft.fopRegisteredOn}
                onChange={(v) => update("fopRegisteredOn", v, [K.fopRegisteredOn])}
                today={today}
                max={today}
                emptyLabel="Not set"
                clearLabel="Clear registration date"
                invalid={!!err(K.fopRegisteredOn)}
              />
              <FieldError>{err(K.fopRegisteredOn)}</FieldError>
            </Field>
            <Field data-invalid={!!err(K.fopDeregisteredOn) || undefined}>
              <FieldLabel htmlFor="fop-deregistered-on">Deregistered on</FieldLabel>
              <OptionalDatePicker
                id="fop-deregistered-on"
                startYear={EARLIEST_DATE_YEAR}
                value={draft.fopDeregisteredOn}
                onChange={(v) => update("fopDeregisteredOn", v, [K.fopDeregisteredOn])}
                today={today}
                min={draft.fopRegisteredOn ?? undefined}
                emptyLabel="Still registered"
                clearLabel="Clear deregistration date"
                invalid={!!err(K.fopDeregisteredOn)}
              />
              <FieldError>{err(K.fopDeregisteredOn)}</FieldError>
            </Field>
          </div>

          <SwitchField
            id="vat-payer"
            label="VAT payer"
            description="3% instead of 5%; record amounts without VAT."
            checked={draft.vatPayer}
            onCheckedChange={(v) => update("vatPayer", v)}
          />
          <SwitchField
            id="levy-enabled"
            label="Military levy"
            description={`${formatBp(levyBp)} of income from ${formatDate(MILITARY_LEVY_START)}`}
            checked={draft.militaryLevyEnabled}
            onCheckedChange={(v) => update("militaryLevyEnabled", v)}
          />
          {draft.militaryLevyEnabled ? (
            <Field data-invalid={!!err(K.militaryLevyEndDate) || undefined}>
              <FieldLabel htmlFor="levy-end">Levy ends</FieldLabel>
              <LevyEndSelect
                id="levy-end"
                value={draft.militaryLevyEndDate}
                onChange={(v) => update("militaryLevyEndDate", v, [K.militaryLevyEndDate])}
                today={today}
                invalid={!!err(K.militaryLevyEndDate)}
              />
              <FieldError>{err(K.militaryLevyEndDate)}</FieldError>
            </Field>
          ) : null}
        </FieldGroup>
      </SectionCard>

      {/* ------------------------------------------------ ЄСВ */}
      <SectionCard id="esv" className="scroll-mt-16" title="ЄСВ">
        <div className="flex flex-col gap-5">
          <FieldSet>
            <FieldLegend variant="label" className="sr-only">
              How do you pay ЄСВ?
            </FieldLegend>
            <RadioGroup
              value={draft.esvMode}
              onValueChange={(v) => update("esvMode", v as EsvMode, [K.esvMode, K.esvCustomMonthlyBase])}
              className="flex flex-col gap-3"
            >
              {ESV_MODES.map((mode) => (
                <Field key={mode} orientation="horizontal" className="gap-2">
                  <RadioGroupItem value={mode} id={`esv-mode-${mode}`} />
                  <FieldLabel htmlFor={`esv-mode-${mode}`} className="font-normal">
                    {ESV_MODE_LABELS[mode]}
                  </FieldLabel>
                </Field>
              ))}
            </RadioGroup>
            <FieldError>{err(K.esvMode)}</FieldError>
          </FieldSet>

          {draft.esvMode === "employed" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!err(K.employedFrom) || undefined}>
                <FieldLabel htmlFor="employed-from">Employed from</FieldLabel>
                <OptionalDatePicker
                  id="employed-from"
                  startYear={EARLIEST_DATE_YEAR}
                  value={draft.employedFrom}
                  onChange={(v) => update("employedFrom", v, [K.employedFrom, K.employedTo])}
                  today={today}
                  max={draft.employedTo ?? undefined}
                  emptyLabel="Open start"
                  clearLabel="Clear employed from"
                  invalid={!!err(K.employedFrom)}
                />
                <FieldError>{err(K.employedFrom)}</FieldError>
              </Field>
              <Field data-invalid={!!err(K.employedTo) || undefined}>
                <FieldLabel htmlFor="employed-to">Employed to</FieldLabel>
                <OptionalDatePicker
                  id="employed-to"
                  startYear={EARLIEST_DATE_YEAR}
                  value={draft.employedTo}
                  onChange={(v) => update("employedTo", v, [K.employedFrom, K.employedTo])}
                  today={today}
                  min={draft.employedFrom ?? undefined}
                  emptyLabel="Still employed"
                  clearLabel="Clear employed to"
                  invalid={!!err(K.employedTo)}
                />
                <FieldError>{err(K.employedTo)}</FieldError>
              </Field>
            </div>
          ) : null}

          {draft.esvMode === "custom" ? (
            <Field data-invalid={!!err(K.esvCustomMonthlyBase) || undefined}>
              <FieldLabel htmlFor="esv-custom-base">Monthly base</FieldLabel>
              <MoneyInput
                id="esv-custom-base"
                currency="UAH"
                className="sm:w-60"
                value={draft.customBase}
                onChange={(v) => update("customBase", v, [K.esvCustomMonthlyBase])}
                invalid={!!err(K.esvCustomMonthlyBase)}
              />
              <FieldDescription className="text-xs">
                {formatMonth(month)}: {formatMoney(esvNow.amount, "UAH")} (base {formatMoney(minimumWage(month), "UAH")} –{" "}
                {formatMoney(maxEsvBase(month), "UAH")})
              </FieldDescription>
              <FieldError>{err(K.esvCustomMonthlyBase)}</FieldError>
            </Field>
          ) : null}

          {draft.esvMode === "minimum" ? (
            <p className="text-sm text-muted-foreground">{formatMoney(minEsvNow, "UAH")} per month in {yearOf(today)}</p>
          ) : null}
          {draft.esvMode === "exempt" ? <p className="text-sm text-muted-foreground">No ЄСВ for any month.</p> : null}
        </div>
      </SectionCard>

      {/* ------------------------------------------------ Advanced (open when something in it is set) */}
      <Disclosure title="Advanced" defaultOpen={hasAdvanced(draftFromTax(tax))}>
        <FieldGroup className="gap-5">
          <SwitchField
            id="single-tax-override"
            label="Custom single tax rate"
            checked={draft.singleTaxOverrideOn}
            onCheckedChange={(v) => update("singleTaxOverrideOn", v, [K.singleTaxRateOverridePct])}
          />
          {draft.singleTaxOverrideOn ? (
            <Field data-invalid={!!err(K.singleTaxRateOverridePct) || undefined}>
              <FieldLabel htmlFor="single-tax-rate">Single tax rate</FieldLabel>
              <PercentInput
                id="single-tax-rate"
                value={draft.singleTaxOverride}
                onChange={(v) => update("singleTaxOverride", v, [K.singleTaxRateOverridePct])}
                placeholder={draft.vatPayer ? "3" : "5"}
                invalid={!!err(K.singleTaxRateOverridePct)}
              />
              <FieldError>{err(K.singleTaxRateOverridePct)}</FieldError>
            </Field>
          ) : null}

          {draft.militaryLevyEnabled ? (
            <>
              <SwitchField
                id="levy-override"
                label="Custom levy rate"
                checked={draft.levyOverrideOn}
                onCheckedChange={(v) => update("levyOverrideOn", v, [K.militaryLevyRateOverridePct])}
              />
              {draft.levyOverrideOn ? (
                <Field data-invalid={!!err(K.militaryLevyRateOverridePct) || undefined}>
                  <FieldLabel htmlFor="levy-rate">Military levy rate</FieldLabel>
                  <PercentInput
                    id="levy-rate"
                    value={draft.levyOverride}
                    onChange={(v) => update("levyOverride", v, [K.militaryLevyRateOverridePct])}
                    placeholder="1"
                    invalid={!!err(K.militaryLevyRateOverridePct)}
                  />
                  <FieldError>{err(K.militaryLevyRateOverridePct)}</FieldError>
                </Field>
              ) : null}
            </>
          ) : null}

          {draft.esvMode !== "exempt" ? (
            <SwitchField
              id="esv-2024-opt-out"
              label="I did not pay ЄСВ for 2024 (martial-law right)"
              description="Affects 2024 months only."
              checked={draft.esv2024OptOut}
              onCheckedChange={(v) => update("esv2024OptOut", v)}
            />
          ) : null}
        </FieldGroup>

        {/* Shown in every mode: a military-service period also exempts the single tax and the levy. */}
        <ExemptPeriodsEditor rows={draft.esvExemptPeriods} onChange={(rows, clear) => update("esvExemptPeriods", rows, clear)} err={err} />

        <section aria-labelledby="esv-months-title" className="flex flex-col gap-3">
          <h3 id="esv-months-title" className="text-sm font-medium">
            ЄСВ month by month
          </h3>
          <EsvMonthEditor
            tax={preview}
            today={today}
            disabled={pending}
            onToggle={(m) => update("esvUncoveredMonths", toggleMonth(draft.esvUncoveredMonths, m), [K.esvUncoveredMonths])}
          />
          <FieldError>{err(K.esvUncoveredMonths)}</FieldError>
        </section>
      </Disclosure>

      {/* ------------------------------------------------ Save bar (sticks to the bottom while there are unsaved changes) */}
      <div
        className={cn(
          "flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between",
          dirty && "sticky bottom-0 z-10 bg-background/95 pb-4 backdrop-blur",
        )}
      >
        <p className="min-w-0 text-xs text-muted-foreground" aria-live="polite">
          {dirty ? <span className="font-medium text-foreground">Unsaved changes · </span> : null}
          {summary}
        </p>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
          {dirty ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={reset}>
              Discard changes
            </Button>
          ) : null}
          <Button type="submit" disabled={!dirty || pending}>
            {pending ? <Spinner /> : null}
            Save tax settings
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Anything set under "Advanced" (it then starts open, so a saved override is never hidden). */
function hasAdvanced(d: TaxDraft): boolean {
  return d.singleTaxOverrideOn || d.levyOverrideOn || d.esv2024OptOut || d.esvExemptPeriods.length > 0 || d.esvUncoveredMonths.length > 0;
}

/**
 * Month ranges with no own ЄСВ (pension, disability, military service, occupied territory —
 * research/tax-rules.md §4.2). Unlike the "Exempt" mode they only cover the months listed.
 */
function ExemptPeriodsEditor({
  rows,
  onChange,
  err,
}: {
  rows: ExemptPeriodDraft[];
  onChange: (rows: ExemptPeriodDraft[], clear: readonly string[]) => void;
  err: (key: string) => string | undefined;
}) {
  // Any edit can shift row indexes, so clear every period error.
  const clear = rows.flatMap((_, i) => (["from", "to", "note"] as const).map((f) => exemptPeriodKey(i, f)));
  const set = (i: number, patch: Partial<ExemptPeriodDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)), clear);
  return (
    <FieldSet className="gap-3" data-testid="esv-exempt-periods">
      <FieldLegend variant="label">ЄСВ exempt periods</FieldLegend>
      <FieldDescription className="text-xs">Pension, disability, military service, occupied territory.</FieldDescription>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const fromErr = err(exemptPeriodKey(i, "from"));
            const toErr = err(exemptPeriodKey(i, "to"));
            return (
              <li key={i} className="grid gap-2 border-b pb-3 sm:grid-cols-[9.5rem_9.5rem_minmax(0,1fr)_auto] sm:items-start">
                <Field data-invalid={!!fromErr || undefined} className="gap-1">
                  <FieldLabel htmlFor={`esv-exempt-from-${i}`} className="text-xs">
                    From month
                  </FieldLabel>
                  <Input
                    id={`esv-exempt-from-${i}`}
                    type="month"
                    value={r.from}
                    onChange={(e) => set(i, { from: e.target.value })}
                    aria-invalid={!!fromErr || undefined}
                  />
                  <FieldError>{fromErr}</FieldError>
                </Field>
                <Field data-invalid={!!toErr || undefined} className="gap-1">
                  <FieldLabel htmlFor={`esv-exempt-to-${i}`} className="text-xs">
                    To month <span className="font-normal text-muted-foreground">(empty = ongoing)</span>
                  </FieldLabel>
                  <Input
                    id={`esv-exempt-to-${i}`}
                    type="month"
                    value={r.to ?? ""}
                    min={r.from || undefined}
                    onChange={(e) => set(i, { to: e.target.value || null })}
                    aria-invalid={!!toErr || undefined}
                  />
                  <FieldError>{toErr}</FieldError>
                </Field>
                <Field className="gap-1">
                  <FieldLabel htmlFor={`esv-exempt-note-${i}`} className="text-xs">
                    Reason <span className="font-normal text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <Input
                    id={`esv-exempt-note-${i}`}
                    value={r.note}
                    maxLength={200}
                    placeholder="e.g. Military service"
                    onChange={(e) => set(i, { note: e.target.value })}
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="justify-self-end sm:mt-6"
                  aria-label={`Remove exempt period ${i + 1}`}
                  onClick={() => onChange(rows.filter((_, j) => j !== i), clear)}
                >
                  <X />
                </Button>
                <Field orientation="horizontal" className="gap-2 sm:col-span-4">
                  <Checkbox
                    id={`esv-exempt-military-${i}`}
                    checked={r.militaryService}
                    onCheckedChange={(v) => set(i, { militaryService: v === true })}
                  />
                  <FieldLabel htmlFor={`esv-exempt-military-${i}`} className="text-xs font-normal">
                    Military service — no single tax or military levy for these months either
                  </FieldLabel>
                </Field>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => onChange([...rows, { from: "", to: null, note: "", militaryService: false }], clear)}>
          <Plus /> Add exempt period
        </Button>
      </div>
    </FieldSet>
  );
}
