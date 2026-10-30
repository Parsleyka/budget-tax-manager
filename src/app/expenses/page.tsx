import type { Metadata } from "next";
import { AddExpenseButton } from "@/components/expenses/add-expense-button";
import { CategoryBreakdown } from "@/components/expenses/category-breakdown";
import {
  dayTotals,
  parseLimit,
  parseSort,
  pickDayTotals,
  sortExpenseRows,
  type ExpenseViewContext,
} from "@/components/expenses/expense-list-model";
import { ExpensesList } from "@/components/expenses/expenses-list";
import { ExpensesNavProvider } from "@/components/expenses/expenses-nav";
import { ExpensesSummary } from "@/components/expenses/expenses-summary";
import { ExpensesToolbar } from "@/components/expenses/expenses-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { getExpensesPageData, getFormOptions } from "@/server/queries";

export const metadata: Metadata = { title: "Spendings" };

/**
 * Spendings (Analytics merged in: the period's figures and the "By category" breakdown). URL contract (all optional):
 *   period/from/to  — PeriodPicker (default: this month)
 *   category        — one or more category ids, comma-separated (multi-select filter)
 *   account         — one account id
 *   q               — text search (note; the loader also matches category/account name and amount)
 *   sort            — date-desc (default) | date-asc | amount-desc | amount-asc
 *   limit           — rows rendered ("Show more"), default 50
 */
export default async function ExpensesPage(props: PageProps<"/expenses">) {
  const searchParams = await props.searchParams;
  // sort/limit are view-only; the loader applies period, categories (multi), account and search.
  const { sort: sortParam, limit: limitParam, ...loaderParams } = searchParams;
  const [data, options] = await Promise.all([getExpensesPageData(loaderParams), getFormOptions()]);

  const filtered = data.rows;
  const categoryIds = data.filters.categoryIds;
  const hasFilters = categoryIds.length > 0 || !!data.filters.accountId || !!data.filters.q;
  const isFreshInstall = !data.hasAnyExpenses;

  const view: ExpenseViewContext = { range: data.range, categoryIds, accountId: data.filters.accountId };
  const dialogOptions = {
    today: options.today,
    accounts: options.accounts,
    categories: options.categories,
    defaultActiveAccountId: options.defaultActiveAccountId,
  };
  // Prefill "Add spending" from the active filters when they point at one usable category / account.
  const addDefaults = {
    categoryId:
      categoryIds.length === 1 && options.categories.some((c) => c.id === categoryIds[0]) ? categoryIds[0] : undefined,
    accountId:
      data.filters.accountId && options.accounts.some((a) => a.id === data.filters.accountId)
        ? data.filters.accountId
        : undefined,
  };

  const addButton = <AddExpenseButton options={dialogOptions} view={view} defaults={addDefaults} />;

  if (isFreshInstall) {
    return (
      <>
        <PageHeader title="Spendings" actions={addButton} />
        <EmptyState
          title="No spendings yet"
          action={<AddExpenseButton options={dialogOptions} view={view} label="Add your first spending" />}
        />
      </>
    );
  }

  const sort = parseSort(sortParam);
  const limit = parseLimit(limitParam);
  const sorted = sortExpenseRows(filtered, sort);
  const rows = sorted.slice(0, limit);

  return (
    <ExpensesNavProvider>
      <PageHeader title="Spendings" actions={addButton}>
        <ExpensesToolbar
          preset={data.filters.preset}
          range={data.range}
          today={data.today}
          categories={data.categories}
          accounts={data.accounts}
          categoryIds={categoryIds}
          accountId={data.filters.accountId}
          q={data.filters.q}
        />
      </PageHeader>

      <ExpensesSummary period={data.period} />

      {data.byCategory.length ? (
        <CategoryBreakdown rows={data.byCategory} knownIds={data.categories.map((c) => c.id)} value={categoryIds} />
      ) : null}

      <ExpensesList
        rows={rows}
        total={filtered.length}
        totalUah={data.totals.totalUah}
        dayTotals={pickDayTotals(dayTotals(filtered), rows.map((r) => r.date))}
        sort={sort}
        limit={limit}
        options={dialogOptions}
        view={view}
        hasFilters={hasFilters}
        isAllTime={data.filters.preset === "all"}
        addDefaults={addDefaults}
      />
    </ExpensesNavProvider>
  );
}
