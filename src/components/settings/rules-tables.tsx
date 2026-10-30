import type * as React from "react";
import { Money } from "@/components/shared/money";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, monthOf, yearOf, type ISODate } from "@/lib/dates";
import { sumMoney } from "@/lib/money";
import type { RulesTable } from "@/lib/tax/rules";
import type { TaxSettings } from "@/lib/types";
import {
  DEADLINE_RULES,
  LIMIT_SOURCES,
  MAX_BASE_SOURCES,
  RATE_SOURCES,
  activeScheduleIndex,
  lawUrl,
  schedulePeriodLabel,
  type RuleSource,
} from "./rule-sources";
import { SourceLink } from "./source-link";

const pctFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });
const pct = (n: number) => `${pctFormat.format(n)}%`;

function InEffect() {
  return (
    <Badge variant="secondary" className="h-4 px-1.5 text-[0.65rem]">
      In effect
    </Badge>
  );
}

/** One reference table: a small heading, the table, an optional one-line note. Edge cells align with the heading. */
function Block({ title, note, children }: { title: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 [&_[data-slot=table]_tr>*:first-child]:pl-0 [&_[data-slot=table]_tr>*:last-child]:pr-0">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

/**
 * Read-only parameter tables the tax engine uses (from `rulesTable()`), each with its legal source.
 * Server Component (no hooks).
 */
export function RulesTables({ rules, today, tax }: { rules: RulesTable; today: ISODate; tax: TaxSettings }) {
  const month = monthOf(today);
  const year = yearOf(today);
  const froms = rules.minimumWage.map((r) => r.from);
  const activeIdx = activeScheduleIndex(froms, month);
  const r = rules.rates;

  const overrides: string[] = [];
  if (tax.singleTaxRateOverridePct !== null) overrides.push(`single tax → ${pct(tax.singleTaxRateOverridePct)}`);
  if (!tax.militaryLevyEnabled) overrides.push("military levy → off");
  else if (tax.militaryLevyRateOverridePct !== null) overrides.push(`military levy → ${pct(tax.militaryLevyRateOverridePct)}`);
  if (tax.militaryLevyEnabled && tax.militaryLevyEndDate) overrides.push(`levy ends ${formatDate(tax.militaryLevyEndDate)}`);

  const rateRows: { label: string; value: string; note?: string; source: RuleSource; extra?: RuleSource; yours?: boolean }[] = [
    {
      label: "Single tax, non-VAT payer",
      value: `${pct(r.singleTaxPct)} of income`,
      source: RATE_SOURCES.singleTax,
      yours: !tax.vatPayer && tax.singleTaxRateOverridePct === null,
    },
    {
      label: "Single tax, VAT payer",
      value: `${pct(r.singleTaxVatPct)} of income excl. VAT`,
      source: RATE_SOURCES.singleTaxVat,
      yours: tax.vatPayer && tax.singleTaxRateOverridePct === null,
    },
    { label: "Income above the annual limit", value: `${pct(r.overLimitPct)} of the excess`, source: RATE_SOURCES.overLimit },
    {
      label: "Military levy",
      value: `${pct(r.militaryLevyPct)} of income`,
      note: `From ${formatDate(r.militaryLevyStart)} (0% in 2024) until 31 Dec of the 3rd year after martial law ends`,
      source: RATE_SOURCES.militaryLevy,
      extra: RATE_SOURCES.militaryLevyEnd,
    },
    { label: "ЄСВ", value: `${pct(r.esvPct)} of the base`, note: "Base: at least the minimum wage of the month", source: RATE_SOURCES.esv },
    {
      label: "Annual income limit",
      value: `${r.limitMultiplier} × minimum wage`,
      note: "Minimum wage in force on 1 January; cumulative calendar-year income",
      source: RATE_SOURCES.limit,
    },
  ];

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Verified on 15 Oct 2026 for {rules.firstYear}–{rules.lastKnownYear}; later years reuse the {rules.lastKnownYear} values.
      </p>

      <Block
        title="Minimum wage & ЄСВ"
        note={
          <>
            Minimum ЄСВ = 22% × МЗП (<SourceLink source={RATE_SOURCES.minimumEsv} />)
          </>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">
                <span className="sm:hidden">МЗП</span>
                <span className="hidden sm:inline">Minimum wage</span>
              </TableHead>
              <TableHead className="text-right">
                <span className="sm:hidden">Min ЄСВ</span>
                <span className="hidden sm:inline">Min ЄСВ / month</span>
              </TableHead>
              <TableHead className="hidden text-right sm:table-cell">Min ЄСВ / quarter</TableHead>
              <TableHead className="hidden text-right md:table-cell">Max base</TableHead>
              <TableHead className="hidden text-right md:table-cell">Max ЄСВ / month</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.minimumWage.map((row, i) => (
              <TableRow key={row.from} data-state={i === activeIdx ? "selected" : undefined}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {schedulePeriodLabel(froms, i)}
                    {i === activeIdx ? <InEffect /> : null}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Money amount={row.amount} currency="UAH" />
                </TableCell>
                <TableCell className="text-right">
                  <Money amount={row.minimumEsv} currency="UAH" />
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <Money amount={sumMoney([row.minimumEsv, row.minimumEsv, row.minimumEsv])} currency="UAH" />
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Money amount={row.maxBase} currency="UAH" />
                </TableCell>
                <TableCell className="hidden text-right md:table-cell">
                  <Money amount={row.maximumEsv} currency="UAH" />
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  <SourceLink source={{ label: row.source, href: lawUrl(row.source) }} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Block>

      <div className="grid gap-8 lg:grid-cols-2">
        <Block
          title="Rates"
          note={
            overrides.length ? (
              <>
                Overridden in your settings: <span className="text-foreground">{overrides.join(", ")}</span>.
              </>
            ) : (
              "Your settings use the statutory rates."
            )
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Parameter</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rateRows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="align-top whitespace-normal">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium">
                      {row.label}
                      {row.yours ? (
                        <Badge variant="outline" className="h-4 px-1.5 text-[0.65rem]">
                          Yours
                        </Badge>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      <SourceLink source={row.source} />
                      {row.extra ? (
                        <>
                          {"; end date: "}
                          <SourceLink source={row.extra} />
                        </>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <span className="tabular-nums">{row.value}</span>
                    {row.note ? <span className="mt-0.5 block text-xs text-muted-foreground">{row.note}</span> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Block>

        <Block
          title="Annual income limit"
          note={
            <>
              <SourceLink source={RATE_SOURCES.limit} />. Over it: 15% on the excess and the general system from the next quarter.
            </>
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">МЗП on 1 Jan</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="hidden sm:table-cell">Published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.limits.map((row) => (
                <TableRow key={row.year} data-state={row.year === year ? "selected" : undefined}>
                  <TableCell>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      {row.year}
                      {row.year === year ? <InEffect /> : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Money amount={row.minimumWageJan1} currency="UAH" />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money amount={row.limit} currency="UAH" />
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                    {LIMIT_SOURCES[row.year] ? <SourceLink source={LIMIT_SOURCES[row.year]} /> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Block>

        <Block title="Maximum ЄСВ base">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Cap</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.maxBaseMultiplier.map((row) => (
                <TableRow key={row.year} data-state={row.year === year ? "selected" : undefined}>
                  <TableCell className="tabular-nums">{row.year}</TableCell>
                  <TableCell className="tabular-nums">{row.multiplier} × МЗП</TableCell>
                  <TableCell className="text-xs whitespace-normal text-muted-foreground">
                    {MAX_BASE_SOURCES[row.year] ? <SourceLink source={MAX_BASE_SOURCES[row.year]} /> : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Block>

        <Block title="Deadlines">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEADLINE_RULES.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="align-top font-medium whitespace-normal">{row.label}</TableCell>
                  <TableCell className="align-top whitespace-normal">
                    {row.rule}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      <SourceLink source={row.source} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Block>
      </div>
    </>
  );
}
