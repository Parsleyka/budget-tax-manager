/**
 * Render smoke test for the Freelancer page components: server-side render with next/navigation and
 * the Server Actions mocked, data produced by the real tax engine. Catches provider / hook wiring
 * mistakes and checks the key content (tax lines, declaration statuses, warnings, empty states).
 */
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { deadlinesForYear, upcomingDeadlines } from "@/lib/tax/deadlines";
import { declarationPaymentStatus, quarterlyDeclaration, summarizeTaxPayments } from "@/lib/tax/engine";
import type { Account, Income, Settings, TaxSettings } from "@/lib/types";
import type { FormOptions, FreelanceIncomeRow } from "@/server/queries";
import { expense, income } from "@/test/factories";
import { DeclarationSection } from "./declaration-section";
import { IncomesSection } from "./incomes-section";
import { overdueItems, paymentQuarterOptions, pickNextDeadline } from "./model";
import { OverdueAlert } from "./overdue-alert";
import { SelectionAlerts } from "./selection-alerts";
import { FreelanceSelectionProvider } from "./selection-context";
import { TaxSummary } from "./tax-summary";
import { UpcomingDeadlines } from "./upcoming-deadlines";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/freelance",
  useSearchParams: () => new URLSearchParams("year=2026"),
}));
vi.mock("@/server/actions/incomes", () => ({ createIncome: vi.fn(), updateIncome: vi.fn(), deleteIncome: vi.fn() }));
vi.mock("@/server/actions/expenses", () => ({ createExpense: vi.fn(), updateExpense: vi.fn(), deleteExpense: vi.fn() }));
vi.mock("@/server/actions/taxes", () => ({ recordTaxPayment: vi.fn() }));
vi.mock("@/server/actions/transfers", () => ({ createTransfer: vi.fn(), updateTransfer: vi.fn(), deleteTransfer: vi.fn() }));

const TODAY = "2026-10-15";
const TS = "2026-01-01T00:00:00.000Z";
const norm = (s: string) => s.replace(/[  ]/g, " ");

const main: Account = { id: "a-main", name: "Main card", group: "active", currency: "UAH", openingBalance: 0, archived: false, createdAt: TS, updatedAt: TS };
const fopUsd: Account = { id: "a-usd", name: "FOP USD", group: "freelancer", currency: "USD", openingBalance: 0, archived: false, createdAt: TS, updatedAt: TS };

function settingsWith(tax: Partial<TaxSettings>): Settings {
  return {
    tax: {
      vatPayer: false,
      singleTaxRateOverridePct: null,
      militaryLevyEnabled: true,
      militaryLevyRateOverridePct: null,
      militaryLevyEndDate: null,
      esvMode: "employed",
      employedFrom: null,
      employedTo: null,
      esvUncoveredMonths: [],
      esvCustomMonthlyBase: null,
      fopRegisteredOn: null,
      ...tax,
    },
    defaultActiveAccountId: main.id,
    createdAt: TS,
    updatedAt: TS,
  };
}

const options: FormOptions = {
  today: TODAY,
  accounts: [main, fopUsd],
  categories: [],
  defaultActiveAccountId: main.id,
  defaultFreelancerAccountIds: { USD: fopUsd.id },
  taxCategoryId: "c-tax",
  balances: { [main.id]: 0, [fopUsd.id]: 0 },
};

function rowsOf(incomes: Income[]): FreelanceIncomeRow[] {
  return incomes.map((i) => ({ ...i, account: i.currency === "USD" ? fopUsd : main, receivedUah: i.amountUah, feeUah: 0 }));
}

function renderPage(
  incomes: Income[],
  settings: Settings,
  months: string[],
  paidExpenses = [] as ReturnType<typeof expense>[],
  initialExpanded: string[] = [],
) {
  const declaration = quarterlyDeclaration(2026, { incomes, settings });
  const statuses = declarationPaymentStatus(declaration, summarizeTaxPayments(paidExpenses), TODAY);
  const quarters = paymentQuarterOptions(declaration, statuses, TODAY);
  const upcoming = upcomingDeadlines(TODAY);
  const next = pickNextDeadline(upcoming, statuses);
  const payment = { quarters, accounts: [main], defaultAccountId: main.id, today: TODAY };
  expect(deadlinesForYear(2026)).toHaveLength(12);
  return norm(
    renderToStaticMarkup(
      h(FreelanceSelectionProvider, {
        year: 2026,
        initialMonths: months,
        incomes,
        settings,
        children: h(
          Fragment,
          null,
          h(OverdueAlert, { items: overdueItems(statuses), ...payment }),
          h(SelectionAlerts),
          h(TaxSummary, {
            settings,
            limit: declaration.limit,
            paymentStatus: statuses,
            aside: h(UpcomingDeadlines, { deadlines: upcoming, statuses, next }),
          }),
          h(IncomesSection, { rows: rowsOf(incomes), options }),
          h(DeclarationSection, {
            declaration,
            statuses,
            today: TODAY,
            next,
            paymentQuarters: quarters,
            accounts: [main],
            defaultAccountId: main.id,
            initialExpanded,
          }),
        ),
      }),
    ),
  );
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Freelancer page render", () => {
  it("renders the tax lines, incomes before/after exchange, deadlines and declarations", () => {
    const incomes = [
      income({ id: "i1", date: "2026-07-10", currency: "USD", amount: 1000, rate: 44, counterparty: "Acme Inc." }),
      income({ id: "i2", date: "2026-08-12", currency: "UAH", amount: 20000 }),
      income({ id: "i3", date: "2026-10-01", currency: "USD", amount: 500, rate: 45, rateSource: "manual" }),
    ];
    const html = renderPage(
      incomes,
      settingsWith({ esvMode: "employed" }),
      ["2026-07", "2026-08", "2026-09"],
      [expense({ id: "p1", amount: 3200, date: "2026-10-10", taxMeta: { kind: "single_tax", period: "2026-Q3" } })],
      ["2026-Q3"],
    );

    // Q3: income 44 000 + 20 000 = 64 000 → 5% = 3 200, 1% = 640; employed → no ЄСВ line at all.
    expect(html).toMatch(/data-testid="tax-income">64 000,00 ₴/);
    expect(html).toMatch(/data-testid="tax-single">3 200,00 ₴/);
    expect(html).toMatch(/data-testid="tax-levy">640,00 ₴/);
    expect(html).toMatch(/data-testid="tax-total">3 840,00 ₴/);
    expect(html).not.toContain('data-testid="tax-esv"');
    expect(html).toContain("Q3 2026");
    expect(html).toContain("1 000 $"); // before exchange

    // Incomes of the selection only (Oct income is excluded), before and after exchange.
    expect(html).toContain("Acme Inc.");
    expect(html).toContain("44,0000");
    expect(html).not.toContain("45,0000");
    expect(html).toContain("1 000,00 $");
    expect(html).toMatch(/data-testid="freelance-total-uah">64 000,00 ₴/);

    // Deadlines: the next three; no ЄСВ deadlines when an employer pays it.
    expect(html).toContain("File declaration");
    expect(html).toContain("Pay single tax + levy");
    expect(html).not.toContain("Pay ЄСВ");

    // Declarations: Q3 expanded — single tax paid, levy still due; Q4 in progress; no ЄСВ rows.
    expect(html).toContain("Details for Q3 2026");
    expect(html).toContain("Record payment for Q3 2026");
    expect(html).toContain("Declaration due 9 Nov 2026");
    expect(html).toContain("In progress");
    expect(html).toContain(">Paid<");
    expect(plain(html)).not.toMatch(/ЄСВ \d/);
    expect(html).not.toContain("Overdue tax payments");
    expect(html).toContain("Taxes for selection");
  });

  it("shows overdue payments and the minimum ЄСВ", () => {
    const incomes = [income({ id: "i1", date: "2026-05-10", currency: "UAH", amount: 100000 })];
    const html = renderPage(incomes, settingsWith({ esvMode: "minimum" }), ["2026-10", "2026-11"]);
    expect(html).toContain("Overdue tax payments:");
    expect(html).toContain("(due 19 Aug)");
    expect(html).toMatch(/data-testid="tax-esv">3 804,68 ₴/); // 2 × 1 902,34 ₴
    expect(html).toContain("No freelance income in the selected months");
    expect(html).toContain("Pay ЄСВ");
  });

  it("renders empty states on a fresh install", () => {
    const html = renderPage([], settingsWith({}), []);
    expect(html).toContain("No months selected");
    expect(html).toContain("No freelance income in 2026");
    // A zero declaration is still due every quarter.
    expect(html).toContain("Declarations");
    expect(html).toContain("Q1 2026");
    expect(html).toContain("Nothing due");
  });

  it("TAX-4: flags the forced switch to the general system in the declaration", () => {
    const incomes = [
      income({ id: "i1", date: "2026-03-10", currency: "UAH", amount: 5_000_000 }),
      income({ id: "i2", date: "2026-06-10", currency: "UAH", amount: 4_150_000 }),
      income({ id: "i3", date: "2026-08-20", currency: "UAH", amount: 1_044_456.29 }),
      income({ id: "i4", date: "2026-10-05", currency: "UAH", amount: 10_000 }),
    ];
    const html = renderPage(incomes, settingsWith({}), ["2026-10"]);
    expect(html).toContain("Income limit exceeded — general system from 1 Oct 2026");
    expect(html).toContain('data-testid="after-forced-switch"');
    expect(html).toContain("General taxation system — only ЄСВ");
    expect(html).toContain("Switch to the general system required");
  });

  it("JOURNEY-7: the tax figure is the accrual for the selection, with what is paid and still to pay", () => {
    const incomes = [
      income({ id: "i1", date: "2026-02-10", currency: "UAH", amount: 100_000 }),
      income({ id: "i2", date: "2026-05-10", currency: "UAH", amount: 100_000 }),
      income({ id: "i3", date: "2026-08-10", currency: "UAH", amount: 100_000 }),
      income({ id: "i4", date: "2026-10-05", currency: "UAH", amount: 20_000 }),
    ];
    const paid = [1, 2, 3].flatMap((q) => [
      expense({ id: `s${q}`, amount: 5000, date: "2026-10-01", taxMeta: { kind: "single_tax", period: `2026-Q${q}` } }),
      expense({ id: `l${q}`, amount: 1000, date: "2026-10-01", taxMeta: { kind: "military_levy", period: `2026-Q${q}` } }),
    ]);
    const ytd = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const html = renderPage(incomes, settingsWith({ esvMode: "employed" }), ytd, paid);
    const text = plain(html);
    expect(text).toContain("Taxes for selection 19 200,00 ₴ Paid 18 000,00 ₴ · 1 200,00 ₴ still to pay (Q1–Q4 2026)");
    expect(html).toMatch(/data-testid="tax-total">19 200,00 ₴/);
  });

  it("TAX-5: months of military service show no single tax / levy and say why", () => {
    const incomes = [income({ id: "i1", date: "2026-04-10", currency: "UAH", amount: 100_000 })];
    const settings = settingsWith({
      esvMode: "employed", // ЄСВ covered by the employer, so only the single tax / levy could be overdue
      esvExemptPeriods: [{ from: "2026-04", to: "2026-05", note: "Mobilised", militaryService: true }],
    });
    const html = renderPage(incomes, settings, ["2026-04"], [], ["2026-Q2"]);
    expect(html).toContain("Military service months");
    expect(html).toContain('data-testid="military-service-months"');
    expect(html).toContain("military service (Apr 2026, May 2026): no single tax or levy");
    expect(html.match(/data-testid="tax-single">0,00 ₴/g)).toHaveLength(1);
    expect(html).not.toContain("Overdue tax payments"); // Q2 single tax / levy are not due
  });

  it("TAX-3: a quarter covered by an earlier overpayment shows the credit, not Overdue", () => {
    const html = renderPage(
      [],
      settingsWith({ esvMode: "minimum" }),
      ["2026-01"],
      [expense({ id: "p1", amount: 22828.08, date: "2026-01-20", taxMeta: { kind: "esv", period: "2026-Q1" } })],
      ["2026-Q1", "2026-Q2"],
    );
    expect(html).not.toContain("Overdue tax payments");
    expect(html).toContain("Overpaid · carried over");
    expect(html).toContain("Paid from credit");
    expect(html).toContain("5 707,02 ₴</span> credit");
  });
});
