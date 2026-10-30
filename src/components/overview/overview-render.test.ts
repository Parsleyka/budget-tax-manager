/**
 * Smoke render of the Overview building blocks to static HTML (fresh install and with data):
 * catches runtime errors and checks the key figures and labels reach the markup.
 */
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { periodTotals } from "@/lib/analytics";
import { balanceSheet, computeBalances, type FxRates } from "@/lib/ledger";
import { resolvePeriod } from "@/lib/periods";
import { upcomingDeadlines } from "@/lib/tax/deadlines";
import { recentTransactions, type TransactionsData } from "@/lib/transactions";
import type { HeaderRates } from "@/server/nbu/rates";
import type { FormOptions, OverviewData } from "@/server/queries";
import { account, adjustment, category, expense, income, transfer } from "@/test/factories";
import { BalanceTiles } from "./balance-tiles";
import { DisplayCurrencyProvider } from "./display-currency";
import { FrozenBreakdownCard } from "./frozen-breakdown-card";
import { GettingStartedCard } from "./getting-started-card";
import { OverviewHeaderActions } from "./overview-header-actions";
import { RecentTransactionsCard } from "./recent-transactions-card";
import { TaxDeadlineLine } from "./tax-deadline-line";
import { ThisMonthCard } from "./this-month-card";

const TODAY = "2026-10-15";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

const render = (node: ReactNode) => renderToStaticMarkup(h(TooltipProvider, null, node));

const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH" });
const fopUsd = account({ id: "fop-usd", name: "FOP USD", group: "freelancer", currency: "USD" });
const fopUah = account({ id: "fop-uah", name: "FOP UAH", group: "freelancer", currency: "UAH" });
const ibkr = account({ id: "ibkr", name: "IBKR", group: "ibkr", currency: "USD" });
const deposits = account({ id: "dep", name: "Deposits", group: "deposits", currency: "UAH" });
const other = account({ id: "other", name: "Other", group: "other", currency: "UAH" });
const groceries = category({ id: "groc", name: "Groceries", color: "blue", icon: "ShoppingCart" });
const taxes = category({ id: "tax", name: "Taxes", color: "red", icon: "Landmark", systemKey: "taxes" });

const RATES: HeaderRates = {
  today: TODAY,
  USD: {
    currency: "USD",
    rate: 41.5,
    effectiveDate: TODAY,
    stale: false,
    previous: { date: "2026-10-14", rate: 41.45 },
    change: 0.05,
    changePct: 0.05 / 41.45,
    tomorrow: { date: "2026-10-16", rate: 41.6 },
  },
  EUR: {
    currency: "EUR",
    rate: 48.25,
    effectiveDate: "2026-10-13",
    stale: true,
    previous: null,
    change: null,
    changePct: null,
    tomorrow: null,
  },
  PLN: {
    currency: "PLN",
    rate: 11.5401,
    effectiveDate: TODAY,
    stale: false,
    previous: { date: "2026-10-14", rate: 11.5573 },
    change: -0.0172,
    changePct: -0.0172 / 11.5573,
    tomorrow: null,
  },
  offline: false,
};

const fx = (r: HeaderRates): FxRates => ({
  USD: r.USD ? { rate: r.USD.rate, date: r.USD.effectiveDate, stale: r.USD.stale } : null,
  EUR: r.EUR ? { rate: r.EUR.rate, date: r.EUR.effectiveDate, stale: r.EUR.stale } : null,
  PLN: r.PLN ? { rate: r.PLN.rate, date: r.PLN.effectiveDate, stale: r.PLN.stale } : null,
});

function overview(data: TransactionsData, rates: HeaderRates = RATES): OverviewData {
  const range = resolvePeriod("this-month", TODAY);
  return {
    today: TODAY,
    rates,
    balances: balanceSheet(data, fx(rates)),
    thisMonth: { range, totals: periodTotals(data, range) },
    recent: recentTransactions(data, 10),
    isEmpty: data.incomes.length + data.expenses.length + data.transfers.length + data.adjustments.length === 0,
    taxDeadlines: upcomingDeadlines(TODAY, { count: 3 }),
    taxPaymentStatus: [],
    taxOverdue: [],
  };
}

function formOptions(data: TransactionsData): FormOptions {
  return {
    today: TODAY,
    accounts: [...data.accounts],
    categories: [...data.categories],
    defaultActiveAccountId: "main",
    defaultFreelancerAccountIds: { USD: "fop-usd", UAH: "fop-uah" },
    taxCategoryId: "tax",
    balances: computeBalances(data),
  };
}

const EMPTY: TransactionsData = {
  accounts: [main, fopUah, fopUsd, ibkr, deposits, other],
  categories: [groceries, taxes],
  incomes: [],
  expenses: [],
  transfers: [],
  adjustments: [],
};

const FULL: TransactionsData = {
  ...EMPTY,
  incomes: [
    income({ id: "sal", kind: "salary", date: "2026-10-05", amount: 40000, currency: "UAH", accountId: "main", counterparty: "ACME" }),
    income({ id: "fr", kind: "freelance", date: "2026-10-12", amount: 1000, fee: 10, currency: "USD", rate: 41.4, accountId: "fop-usd", counterparty: "Client" }),
  ],
  expenses: [
    expense({ id: "e1", date: TODAY, amount: 1250.5, accountId: "main", categoryId: "groc", note: "Silpo" }),
    expense({ id: "e2", date: "2026-10-14", amount: 2000, accountId: "main", categoryId: "tax", taxMeta: { kind: "esv", period: "2026-Q3" } }),
  ],
  transfers: [transfer({ id: "t1", date: "2026-10-13", fromAccountId: "fop-usd", toAccountId: "main", fromAmount: 500, toAmount: 20700 })],
  adjustments: [
    adjustment({ id: "a1", date: "2026-10-10", accountId: "ibkr", delta: 300, note: "Market value" }),
    adjustment({ id: "a2", date: "2026-10-10", accountId: "dep", delta: 50000 }),
  ],
};

describe("Overview — fresh install", () => {
  const data = overview(EMPTY);
  const options = formOptions(EMPTY);

  it("renders zero balances, an empty Frozen section and the welcome line", () => {
    const html = text(render(h("div", null, h(GettingStartedCard, { options }), h(BalanceTiles, { balances: data.balances }), h(FrozenBreakdownCard, { balances: data.balances }))));
    expect(html).toContain("Start with today’s balances");
    expect(html).toContain("Enter current balance");
    expect(html).toContain("Net worth");
    expect(html).toContain("Active balance");
    expect(html).toContain("0,00 ₴");
    expect(html).toContain("Nothing set aside yet");
  });

  it("renders quiet empty states for this month and recent transactions", () => {
    const html = text(render(h("div", null, h(ThisMonthCard, { thisMonth: data.thisMonth }), h(RecentTransactionsCard, { rows: data.recent, today: TODAY }))));
    expect(html).toContain("Nothing recorded in October yet");
    expect(html).toContain("No transactions yet");
  });

  it("renders Add spending and the “More actions” menu trigger", () => {
    const markup = render(h(OverviewHeaderActions, { options }));
    expect(text(markup)).toContain("Add spending");
    expect(markup).toContain('aria-label="More actions"');
  });
});

describe("Overview — with data", () => {
  const data = overview(FULL);

  it("shows Net worth, Active and Frozen (exact UAH math at today's rates)", () => {
    // main: 40000 − 1250.50 − 2000 + 20700 = 57449.50
    // fop-usd: 990 − 500 = 490 $ → 20335 ₴; ibkr: 300 $ → 12450 ₴; deposits 50000 → frozen 82785
    const html = text(render(h(BalanceTiles, { balances: data.balances })));
    expect(html).toContain("Net worth 140 234,50 ₴");
    expect(html).toContain("Active balance 57 449,50 ₴");
    expect(html).toContain("Frozen balance 82 785,00 ₴");
    expect(html).not.toContain("NBU rates from"); // EUR is stale but no EUR balance
  });

  it("shows the totals in the chosen display currency", () => {
    const markup = render(h(DisplayCurrencyProvider, { initial: "USD", rates: { USD: 41.5 }, children: h(BalanceTiles, { balances: data.balances }) }));
    expect(text(markup)).toContain("Net worth 3 379,14 $"); // 140 234,50 / 41,5 = 3 379,144…
    expect(markup).toContain('data-display-currency="USD"');
  });

  it("lists Frozen by group with shares, leaving out empty groups", () => {
    const html = text(render(h(FrozenBreakdownCard, { balances: data.balances })));
    expect(html).toContain("Freelancer 20 335,00 ₴ 24,6%");
    expect(html).toContain("Investments 12 450,00 ₴ 15,0%");
    expect(html).toContain("Deposits 50 000,00 ₴ 60,4%");
    expect(html).not.toContain("Other");
    expect(html).not.toContain("FOP USD"); // no per-account rows
  });

  it("LEDGER-4: the shown group shares add up to 100,0 %", () => {
    const acc = (id: string, group: "freelancer" | "ibkr" | "deposits" | "other", openingBalance: number) =>
      account({ id, name: `Acc ${id}`, group, currency: "UAH", openingBalance });
    const sheet = balanceSheet(
      { accounts: [acc("f", "freelancer", 2473.78), acc("i", "ibkr", 2393.43), acc("d", "deposits", 5121.39), acc("o", "other", 11.4)], incomes: [], expenses: [], transfers: [], adjustments: [] },
      { USD: null, EUR: null },
    );
    const html = text(render(h(FrozenBreakdownCard, { balances: sheet })));
    // Rounded alone: 24,7 + 23,9 + 51,2 + 0,1 = 99,9 %.
    for (const share of ["24,8%", "23,9%", "51,2%", "0,1%"]) expect(html).toContain(share);
  });

  it("summarises this month: income, spending and net", () => {
    const html = text(render(h(ThisMonthCard, { thisMonth: data.thisMonth })));
    // freelance: 1000 $ × 41.4 = 41400 gross, fee 10 $ = 414 → net 40986; income = 80986
    expect(html).toContain("Income 80 986,00 ₴");
    expect(html).toContain("Spending 3 250,50 ₴");
    expect(html).toContain("Net +77 735,50 ₴");
  });

  it("lists the latest 5 transactions, newest first, with links", () => {
    const markup = render(h(RecentTransactionsCard, { rows: data.recent, today: TODAY }));
    const html = text(markup);
    expect(html).toContain("Groceries");
    expect(html).toContain("Today · Main card · Silpo");
    expect(html).toContain("Yesterday · Main card");
    expect(html).toContain("FOP USD → Main card");
    expect(html).toContain("Freelance · Client");
    expect(html).not.toContain("ACME"); // the 5 Oct salary is the 7th movement
    expect(markup.match(/data-testid="recent-(?!transactions)/g)).toHaveLength(5);
    expect(markup).toContain('href="/expenses?period=custom&amp;from=2026-10-15&amp;to=2026-10-15"');
    expect(markup).toContain('href="/accounts#transfers"');
    expect(markup.indexOf("recent-expense")).toBeLessThan(markup.indexOf("recent-transfer"));
  });

  it("shows the next tax deadline as one line", () => {
    const html = text(render(h(TaxDeadlineLine, { deadlines: upcomingDeadlines(TODAY, { count: 3 }) })));
    expect(html).toContain("Pay ЄСВ · Q3 2026 · 19 Oct · in 4 days");
    expect(html).not.toContain("File declaration");
  });

  it("adds the outstanding amount when a paid-vs-due status is supplied", () => {
    const item = (outstanding: number, state: "unpaid" | "nothing-due") => ({
      kind: "esv" as const,
      due: outstanding,
      paid: 0,
      creditApplied: 0,
      carriedForward: 0,
      outstanding,
      state,
      deadline: "2026-10-19",
      overdue: false,
      daysLeft: 4,
    });
    const html = text(
      render(
        h(TaxDeadlineLine, {
          deadlines: upcomingDeadlines(TODAY, { count: 3 }),
          paymentStatus: [
            {
              period: "2026-Q3",
              quarter: 3,
              items: { single_tax: item(0, "nothing-due"), military_levy: item(0, "nothing-due"), esv: item(5707.02, "unpaid") },
              outstanding: 5707.02,
            },
          ],
        }),
      ),
    );
    expect(html).toContain("in 4 days · 5 707,02 ₴ to pay");
  });

  it("REACT-2 / TAX-2: headlines the first deadline that needs action and flags overdue taxes of any year", () => {
    const item = (kind: "single_tax" | "military_levy" | "esv", due: number, state: "unpaid" | "nothing-due") => ({
      kind,
      due,
      paid: 0,
      creditApplied: 0,
      carriedForward: 0,
      outstanding: due,
      state,
      deadline: kind === "esv" ? "2026-10-19" : "2026-11-19",
      overdue: false,
      daysLeft: kind === "esv" ? 4 : 35,
    });
    const html = text(
      render(
        h(TaxDeadlineLine, {
          deadlines: upcomingDeadlines(TODAY, { count: 6 }),
          paymentStatus: [
            {
              period: "2026-Q3",
              quarter: 3,
              // Employed: ЄСВ covered by the employer → nothing due on 19 Oct.
              items: { single_tax: item("single_tax", 500, "unpaid"), military_levy: item("military_levy", 100, "unpaid"), esv: item("esv", 0, "nothing-due") },
              outstanding: 600,
            },
          ],
          overdue: [
            { period: "2025-Q4", kind: "single_tax", outstanding: 24712.38, deadline: "2026-02-19" },
            { period: "2025-Q4", kind: "military_levy", outstanding: 4942.48, deadline: "2026-02-19" },
          ],
        }),
      ),
    );
    expect(html).toContain("Overdue taxes · 29 654,86 ₴");
    // The ЄСВ deadline on 19 Oct has nothing due → the filing on 9 Nov is the headline.
    expect(html).toContain("File declaration · Q3 2026 · 9 Nov");
    expect(html).not.toContain("Pay ЄСВ");
  });
});
