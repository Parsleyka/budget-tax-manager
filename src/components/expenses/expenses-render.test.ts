/**
 * Render smoke test for the Spendings UI (server-side render of the client components with
 * next/navigation and the Server Actions mocked). Catches hook/provider wiring mistakes and checks
 * the key structure: day groups, plain table, period figures, "By category", "Show more", empty states.
 */
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CategorySpending } from "@/lib/analytics";
import type { Account, Category } from "@/lib/types";
import type { ExpenseRow, ExpensesPageData, FormOptions } from "@/server/queries";
import ExpensesPage from "@/app/expenses/page";
import { CategoryBreakdown } from "./category-breakdown";
import { dayTotals, groupByDay, type ExpenseViewContext } from "./expense-list-model";
import { ExpensesList, type ExpensesListProps } from "./expenses-list";
import { ExpensesNavProvider } from "./expenses-nav";
import { ExpensesSummary } from "./expenses-summary";
import { ExpensesToolbar } from "./expenses-toolbar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/expenses",
  useSearchParams: () => new URLSearchParams("period=this-month"),
}));

const fixture = vi.hoisted(() => ({
  data: null as unknown,
  options: null as unknown,
  calls: [] as Record<string, unknown>[],
}));

vi.mock("@/server/queries", () => ({
  getExpensesPageData: vi.fn(async (sp: Record<string, unknown>) => {
    fixture.calls.push(sp);
    return fixture.data as ExpensesPageData;
  }),
  getFormOptions: vi.fn(async () => fixture.options),
}));

vi.mock("@/server/actions/expenses", () => ({
  createExpense: vi.fn(),
  updateExpense: vi.fn(),
  deleteExpense: vi.fn(),
}));

const TS = "2026-10-01T00:00:00.000Z";
const groceries: Category = { id: "c-groc", name: "Groceries", color: "blue", icon: "ShoppingCart", archived: false, createdAt: TS, updatedAt: TS };
const taxes: Category = { id: "c-tax", name: "Taxes", color: "red", icon: "Landmark", systemKey: "taxes", archived: false, createdAt: TS, updatedAt: TS };
const old: Category = { id: "c-old", name: "Old stuff", color: "gray", archived: true, createdAt: TS, updatedAt: TS };
const main: Account = { id: "a-main", name: "Main card", group: "active", currency: "UAH", openingBalance: 0, archived: false, createdAt: TS, updatedAt: TS };
const usd: Account = { id: "a-usd", name: "FOP USD", group: "freelancer", currency: "USD", openingBalance: 0, archived: false, createdAt: TS, updatedAt: TS };

function row(id: string, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id,
    date,
    amount: 100,
    currency: "UAH",
    rate: 1,
    amountUah: 100,
    categoryId: groceries.id,
    accountId: main.id,
    createdAt: `${date}T10:00:00.000Z`,
    updatedAt: `${date}T10:00:00.000Z`,
    category: groceries,
    account: main,
    ...over,
  };
}

const rows: ExpenseRow[] = [
  row("e1", "2026-10-15", { amount: 1234.5, amountUah: 1234.5, note: "Silpo weekly" }),
  row("e2", "2026-10-15", { amount: 10, currency: "USD", rate: 41.2345, amountUah: 412.35, accountId: usd.id, account: usd, note: "Domain" }),
  row("e3", "2026-10-14", {
    amount: 2000,
    amountUah: 2000,
    categoryId: taxes.id,
    category: taxes,
    note: "Single tax — Q3 2026",
    taxMeta: { kind: "single_tax", period: "2026-Q3" },
  }),
  row("e4", "2026-10-10"),
];

const view: ExpenseViewContext = { range: { from: "2026-10-01", to: "2026-10-15" }, categoryIds: [], accountId: null };
const options = { today: "2026-10-15", accounts: [main, usd], categories: [groceries, taxes], defaultActiveAccountId: main.id };

function listProps(over: Partial<ExpensesListProps> = {}): ExpensesListProps {
  return {
    rows,
    total: 120,
    totalUah: 3746.85,
    dayTotals: dayTotals(rows),
    sort: "date-desc",
    limit: 50,
    options,
    view,
    hasFilters: false,
    isAllTime: false,
    ...over,
  };
}

const render = (child: ReactNode) =>
  renderToStaticMarkup(h(ExpensesNavProvider, { children: child })).replace(/[\u00a0\u202f]/g, " ");

describe("Spendings UI render", () => {
  it("renders the day-grouped list with totals, tax badge, foreign amounts and show-more", () => {
    const html = render(h(ExpensesList, listProps()));
    expect(html).toContain("Today, 15 Oct 2026");
    expect(html).toContain("Yesterday, 14 Oct 2026");
    expect(html).toContain("Sat, 10 Oct 2026");
    expect(html).toContain("1 646,85 ₴"); // 15 Oct day total = 1234,50 + 412,35
    expect(html).toContain("10,00 $");
    expect(html).toContain("≈ <span");
    expect(html).toContain("Tax payment");
    expect(html).toContain("120 spendings · <span"); // count · filtered total in the section header
    expect(html).toContain("3 746,85 ₴");
    expect(html).not.toContain("No note"); // an empty note renders nothing
    expect(html).toContain("Showing 4 of 120");
    expect(html).toContain("Show 50 more");
    expect(html).toContain("Show all");
    expect(html).toContain('aria-sort="none"'); // Amount header is sortable
    expect(html).not.toContain(">Date<"); // grouped mode has no date column
    // both layouts are present (table for wide containers, cards for phones)
    expect(html).toContain("<table");
    expect(html).toContain("<h3");
  });

  it("renders the plain table when sorted by amount", () => {
    const html = render(h(ExpensesList, listProps({ sort: "amount-desc", total: 4 })));
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain("Date");
    expect(html).not.toContain("Showing"); // everything is shown → no footer
    expect(html).not.toContain("Show 50 more");
  });

  it("renders the empty states", () => {
    const period = render(h(ExpensesList, listProps({ rows: [], total: 0, dayTotals: {} })));
    expect(period).toContain("No spendings in 1–15 Oct 2026");
    expect(period).toContain("Show all time");
    expect(period).toContain("Add spending");

    const filtered = render(h(ExpensesList, listProps({ rows: [], total: 0, dayTotals: {}, hasFilters: true, isAllTime: true })));
    expect(filtered).toContain("No spendings match these filters");
    expect(filtered).toContain("Clear filters");
    expect(filtered).not.toContain("Show all time");
  });

  it("renders the toolbar with the active filters", () => {
    const html = render(
      h(ExpensesToolbar, {
        preset: "this-month",
        range: view.range,
        today: "2026-10-15",
        categories: [groceries, old, taxes],
        accounts: [main, usd],
        categoryIds: [groceries.id, taxes.id],
        accountId: usd.id,
        q: "silpo",
      }),
    );
    expect(html).toContain("2 categories");
    expect(html).toContain('value="silpo"');
    expect(html).toContain("Clear filters");
    expect(html).toContain("FOP USD");
  });

  it("renders the period figures (net signed and colored)", () => {
    const html = renderToStaticMarkup(
      h(ExpensesSummary, { period: { spendingUah: 3746.85, incomeUah: 50000, netUah: 46253.15 } }),
    ).replace(/[\u00a0\u202f]/g, " ");
    expect(html).toContain("Spent");
    expect(html).toContain("3 746,85 ₴");
    expect(html).toContain("50 000,00 ₴");
    expect(html).toContain("+46 253,15 ₴");
    expect(html).toContain("text-positive");
    expect(groupByDay(rows)).toHaveLength(3);
  });

  it("renders the by-category breakdown: biggest first, top 6, selected rows pressed, deleted categories inert", () => {
    const spend = (categoryId: string, totalUah: number, name = categoryId): CategorySpending => ({
      categoryId,
      name,
      color: "blue",
      archived: false,
      totalUah,
      count: 1,
      share: 0,
    });
    const many = [spend(groceries.id, 700, "Groceries"), ...["b", "c", "d", "e", "f"].map((id, i) => spend(id, 600 - i * 100)), spend("gone", 10, "Unknown")];
    const html = render(
      h(CategoryBreakdown, { rows: many, knownIds: [groceries.id, "b", "c", "d", "e", "f"], value: [groceries.id] }),
    );
    expect(html).toContain("By category");
    expect(html.indexOf("Groceries")).toBeLessThan(html.indexOf(">b<"));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Show all 7"); // 7 rows, 6 shown
    expect(html).not.toContain("Unknown"); // the 7th is folded
    expect(html.match(/<button/g)?.length).toBe(7); // 6 rows + "Show all"
  });
});

describe("Spendings page", () => {
  const formOptions: FormOptions = {
    today: "2026-10-15",
    accounts: [main, usd],
    categories: [groceries, taxes],
    defaultActiveAccountId: main.id,
    defaultFreelancerAccountIds: { USD: usd.id },
    taxCategoryId: taxes.id,
    balances: {},
  };
  function pageData(over: Partial<ExpensesPageData> = {}): ExpensesPageData {
    return {
      today: "2026-10-15",
      filters: {
        preset: "this-month",
        from: "2026-10-01",
        to: "2026-10-15",
        categoryIds: [],
        categoryId: null,
        accountId: null,
        q: "",
      },
      range: { from: "2026-10-01", to: "2026-10-15" },
      rows,
      totals: { count: rows.length, totalUah: 3746.85, byCurrency: [] },
      period: { spendingUah: 3746.85, incomeUah: 0, netUah: -3746.85 },
      byCategory: [
        { categoryId: groceries.id, name: "Groceries", color: "blue", archived: false, totalUah: 1746.85, count: 3, share: 0.466 },
        { categoryId: taxes.id, name: "Taxes", color: "red", archived: false, totalUah: 2000, count: 1, share: 0.534 },
      ],
      categories: [groceries, old, taxes],
      accounts: [main, usd],
      hasAnyExpenses: true,
      ...over,
    };
  }
  async function renderPage(searchParams: Record<string, string>) {
    const element = await ExpensesPage({ searchParams: Promise.resolve(searchParams), params: Promise.resolve({}) } as PageProps<"/expenses">);
    return renderToStaticMarkup(element).replace(/[\u00a0\u202f]/g, " ");
  }

  it("shows the first-run empty state on a fresh install", async () => {
    fixture.data = pageData({ rows: [], totals: { count: 0, totalUah: 0, byCurrency: [] }, byCategory: [], hasAnyExpenses: false });
    fixture.options = formOptions;
    const html = await renderPage({});
    expect(html).toContain("No spendings yet");
    expect(html).toContain("Add your first spending");
    expect(html).not.toContain("By category");
  });

  it("shows the period empty state when only this period is empty", async () => {
    fixture.data = pageData({
      rows: [],
      totals: { count: 0, totalUah: 0, byCurrency: [] },
      period: { spendingUah: 0, incomeUah: 1000, netUah: 1000 },
      byCategory: [],
    });
    fixture.options = formOptions;
    const html = await renderPage({});
    expect(html).toContain("No spendings in 1–15 Oct 2026");
    expect(html).not.toContain("No spendings yet");
    expect(html).not.toContain("By category"); // nothing spent → no breakdown
    expect(html).toContain("+1 000,00 ₴");
  });

  it("passes the filters (incl. multi-category) to the loader and applies sort and limit itself", async () => {
    // The loader has already applied ?category=c-tax,nope → only the Taxes row is left.
    const taxRows = rows.filter((r) => r.categoryId === "c-tax");
    fixture.data = pageData({
      rows: taxRows,
      filters: { ...pageData().filters, categoryIds: ["c-tax"], categoryId: "c-tax", q: "tax" },
    });
    fixture.options = formOptions;
    fixture.calls.length = 0;
    const html = await renderPage({ category: "c-tax,nope", sort: "amount-desc", limit: "100", q: "tax", period: "this-month" });
    expect(fixture.calls).toHaveLength(1);
    expect(fixture.calls[0]).toEqual({ category: "c-tax,nope", q: "tax", period: "this-month" });
    expect(html).toContain('aria-sort="descending"');
    // The list follows the filter; the period figures and the breakdown stay whole-period.
    expect(html).toContain("1 spending · <span");
    expect(html).toContain("2 000,00 ₴");
    expect(html).toContain("3 746,85 ₴");
    expect(html).toContain("By category");
    expect(html).not.toContain("Silpo weekly");
  });
});
