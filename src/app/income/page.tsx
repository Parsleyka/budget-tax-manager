import type { Metadata } from "next";
import Link from "next/link";
import type { IncomeDialogOptions } from "@/components/forms/income-dialog";
import { AddIncomeButton } from "@/components/income/add-income-button";
import { IncomeHeaderActions } from "@/components/income/income-header-actions";
import { IncomeKindTabs } from "@/components/income/income-kind-tabs";
import { IncomeRecords } from "@/components/income/income-records";
import { IncomeSummary } from "@/components/income/income-summary";
import {
  INCOME_MAX_LIMIT,
  INCOME_PAGE_SIZE,
  incomeHref,
  parseIncomeLimit,
  pluralIncomes,
  summarizeIncomeRows,
} from "@/components/income/income-view";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { PeriodPicker } from "@/components/shared/period-picker";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { IncomeKind } from "@/lib/types";
import { describeRange, firstParam } from "@/lib/periods";
import { getFormOptions, getIncomePageData, type IncomeKindFilter } from "@/server/queries";

export const metadata: Metadata = { title: "Income" };

const CAPTIONS: Record<IncomeKindFilter, string> = {
  all: "All income",
  salary: "Salary",
  freelance: "Freelance income",
};

export default async function IncomePage(props: PageProps<"/income">) {
  const searchParams = await props.searchParams;
  const [data, formOptions] = await Promise.all([getIncomePageData(searchParams), getFormOptions()]);
  const { kind, preset } = data.filters;

  // Only what IncomeDialog needs (keeps categories / balances out of the client payload).
  const options: IncomeDialogOptions = {
    today: formOptions.today,
    accounts: formOptions.accounts,
    defaultActiveAccountId: formOptions.defaultActiveAccountId,
    defaultFreelancerAccountIds: formOptions.defaultFreelancerAccountIds,
  };

  const view = { range: data.range, kind };
  const addButton = (mode: IncomeKind, variant: "default" | "outline") => (
    <AddIncomeButton mode={mode} options={options} view={view} variant={variant} size="sm">
      {mode === "salary" ? "Add salary" : "Add freelance income"}
    </AddIncomeButton>
  );

  // Long periods render one page at a time (the totals above and the table footer cover every row).
  const limit = parseIncomeLimit(firstParam(searchParams.limit));
  const shownRows = data.rows.slice(0, limit);
  const hidden = data.rows.length - shownRows.length;
  const showMore =
    hidden > 0 ? (
      <span className="flex w-full flex-wrap items-center justify-between gap-2" data-testid="income-show-more">
        <span className="tabular-nums">
          Showing {shownRows.length} of {pluralIncomes(data.rows.length)}
          {limit >= INCOME_MAX_LIMIT ? " — narrow the period to see the rest" : null}
        </span>
        {limit < INCOME_MAX_LIMIT ? (
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href={incomeHref(searchParams, { limit: limit + INCOME_PAGE_SIZE })} scroll={false}>
                Show {Math.min(INCOME_PAGE_SIZE, hidden)} more
              </Link>
            </Button>
            {hidden > INCOME_PAGE_SIZE && data.rows.length <= INCOME_MAX_LIMIT ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={incomeHref(searchParams, { limit: data.rows.length })} scroll={false}>
                  Show all
                </Link>
              </Button>
            ) : null}
          </span>
        ) : null}
      </span>
    ) : undefined;

  const rangeText = describeRange(data.range);
  const fresh = !data.hasAnyIncome;

  return (
    <>
      <PageHeader title="Income" actions={<IncomeHeaderActions options={options} view={view} />}>
        <PeriodPicker preset={preset} range={data.range} today={data.today} resetParams={["limit"]} />
      </PageHeader>

      <IncomeSummary totals={data.totals} />

      <SectionCard footer={showMore}>
        <IncomeKindTabs
          kind={kind}
          counts={{ all: data.totals.count, salary: data.totals.salaryCount, freelance: data.totals.freelanceCount }}
        >
          {data.rows.length ? (
            <IncomeRecords
              rows={shownRows}
              summary={summarizeIncomeRows(data.rows)}
              kind={kind}
              options={options}
              caption={`${CAPTIONS[kind]}, ${rangeText}`}
            />
          ) : data.totals.count === 0 ? (
            <EmptyState
              variant="plain"
              title={fresh ? "No income yet" : "No income in this period"}
              action={
                <>
                  {addButton("salary", "default")}
                  {addButton("freelance", "outline")}
                  {!fresh && preset !== "all" ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={incomeHref(searchParams, { period: "all" })} scroll={false}>
                        Show all time
                      </Link>
                    </Button>
                  ) : null}
                </>
              }
            />
          ) : (
            // Kind tab is empty but the period has income of the other kind.
            <EmptyState
              variant="plain"
              title={kind === "salary" ? "No salary in this period" : "No freelance income in this period"}
              action={
                <>
                  {addButton(kind === "salary" ? "salary" : "freelance", "default")}
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={incomeHref(searchParams, { kind: "all" })} scroll={false}>
                      Show all income
                    </Link>
                  </Button>
                </>
              }
            />
          )}
        </IncomeKindTabs>
      </SectionCard>
    </>
  );
}
