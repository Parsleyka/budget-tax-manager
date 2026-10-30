import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataSnapshot } from "@/lib/types";
import { createNbuMock } from "@/test/nbu-mock";
import { readSnapshot } from "./db/store";
import { resetNbuMemory } from "./nbu/rates";
import { defaultPaymentPeriod } from "@/lib/tax/payments";
import {
  getExpensesPageData,
  getFreelancePageData,
  getIncomePageData,
  getInvestmentsPageData,
  getOverviewData,
  getShellData,
} from "./queries";
import * as expenses from "./services/expenses";
import * as incomes from "./services/incomes";
import { updateSettings } from "./services/settings";

// Loaders call `connection()` (request-scoped in Next); outside a request it is a no-op here.
vi.mock("next/server", () => ({ connection: async () => {} }));

let dir: string;
let s: DataSnapshot;
const accountId = (name: string) => s.accounts.find((a) => a.name === name)!.id;
const categoryId = (name: string) => s.categories.find((c) => c.name === name)!.id;

async function spend(date: string, amount: number, category: string) {
  const r = await expenses.createExpense({ date, amount, accountId: accountId("Main card"), categoryId: categoryId(category) });
  expect(r.ok).toBe(true);
}
async function earn(kind: "salary" | "freelance", date: string, amount: number) {
  const r = await incomes.createIncome({
    kind,
    date,
    amount,
    currency: "UAH",
    accountId: accountId(kind === "salary" ? "Main card" : "FOP UAH"),
  });
  expect(r.ok).toBe(true);
}

async function setup(now: string) {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(now) });
  dir = await mkdtemp(path.join(os.tmpdir(), "budget-queries-test-"));
  process.env.BUDGET_DATA_DIR = dir;
  resetNbuMemory();
  vi.stubGlobal("fetch", createNbuMock({ USD: { "2026-10-15": 44.9801 }, EUR: { "2026-10-15": 50.3453 } }).fetch);
  s = await readSnapshot(); // seeds accounts, categories, settings
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.BUDGET_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("today = 2026-10-15", () => {
  beforeEach(() => setup("2026-10-15T09:00:00Z"));

  it("expenses: multi-category filter (comma list or repeated param), unknown ids dropped, hasAnyExpenses", async () => {
    expect((await getExpensesPageData({})).hasAnyExpenses).toBe(false);
    await spend("2026-10-02", 100, "Groceries");
    await spend("2026-10-03", 50, "Transport");
    await spend("2026-10-04", 20, "Health");

    const groc = categoryId("Groceries");
    const trans = categoryId("Transport");
    const data = await getExpensesPageData({ category: `${groc}, ${trans},deleted-id` });
    expect(data.filters.categoryIds).toEqual([groc, trans]);
    expect(data.filters.categoryId).toBe(groc);
    expect(data.rows.map((r) => r.category?.name).sort()).toEqual(["Groceries", "Transport"]);
    expect(data.totals.totalUah).toBe(150);
    expect(data.hasAnyExpenses).toBe(true);

    const repeated = await getExpensesPageData({ category: [groc, trans] });
    expect(repeated.rows).toHaveLength(2);
    // Only unknown ids → no category filter at all (a stale link shows everything, not nothing).
    expect((await getExpensesPageData({ category: "deleted-id" })).rows).toHaveLength(3);
    // An empty period still knows the data exists.
    const lastYear = await getExpensesPageData({ period: "last-year" });
    expect(lastYear.rows).toHaveLength(0);
    expect(lastYear.hasAnyExpenses).toBe(true);
  });

  it("income: per-kind counts ignore the kind tab; hasAnyIncome", async () => {
    expect((await getIncomePageData({})).hasAnyIncome).toBe(false);
    await earn("salary", "2026-09-10", 50000);
    await earn("salary", "2026-10-10", 52000);
    await earn("freelance", "2026-10-05", 100000);

    const salaryTab = await getIncomePageData({ kind: "salary" });
    expect(salaryTab.rows).toHaveLength(2);
    expect(salaryTab.totals).toMatchObject({ count: 3, salaryCount: 2, freelanceCount: 1 });
    expect(salaryTab.hasAnyIncome).toBe(true);
    expect((await getIncomePageData({ period: "last-year" })).hasAnyIncome).toBe(true);
  });

  it("overview: next deadlines, paid-vs-due for the previous and current year, overdue of any watched year", async () => {
    await earn("freelance", "2025-11-10", 100000); // Q4 2025: 5 000 single tax + 1 000 levy
    const paid = await expenses.recordTaxPayment({
      date: "2026-02-12",
      accountId: accountId("FOP UAH"),
      period: "2025-Q4",
      payments: [{ kind: "single_tax", amount: 5000 }],
    });
    expect(paid.ok).toBe(true);

    const data = await getOverviewData();
    expect(data.taxDeadlines).toHaveLength(6);
    // Default ЄСВ mode "employed": the employer pays ЄСВ, so no "Pay ЄСВ" deadlines (19 Oct is skipped).
    expect(data.taxDeadlines[0]).toMatchObject({ kind: "filing", period: "2026-Q3", date: "2026-11-09" });
    expect(data.taxDeadlines.some((d) => d.kind === "esv")).toBe(false);
    // Watched years + the years of the deadlines looked at (a few extra are fetched, so 2027 is included).
    expect(data.taxPaymentStatus.map((q) => q.period)).toEqual([
      "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4",
      "2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4",
    ]);
    const q4 = data.taxPaymentStatus.find((q) => q.period === "2025-Q4")!;
    expect(q4.items.single_tax).toMatchObject({ due: 5000, paid: 5000, state: "paid" });
    expect(q4.items.military_levy).toMatchObject({ due: 1000, paid: 0, overdue: true });
    // TAX-2 / REACT-1: the unpaid 2025-Q4 levy is reported on the Overview too.
    expect(data.taxOverdue).toEqual([{ period: "2025-Q4", kind: "military_levy", outstanding: 1000, deadline: "2026-02-19" }]);
    // …and on the default Freelancer view (year 2026), with 2025-Q4 bookable from its dialog.
    const fl = await getFreelancePageData({});
    expect(fl.year).toBe(2026);
    expect(fl.overdue).toEqual(data.taxOverdue);
    expect(fl.paymentOptions.map((o) => o.period)).toContain("2025-Q4");
  });

  it("expenses: the period's figures and by-category totals ignore the list filters", async () => {
    await earn("salary", "2026-10-05", 1000);
    await spend("2026-09-05", 300, "Groceries");
    await spend("2026-10-02", 100.1, "Groceries");
    await spend("2026-10-03", 40, "Transport");

    const groc = categoryId("Groceries");
    const data = await getExpensesPageData({ period: "this-month", category: groc, q: "nothing matches" });
    expect(data.rows).toHaveLength(0);
    expect(data.period).toEqual({ spendingUah: 140.1, incomeUah: 1000, netUah: 859.9 });
    expect(data.byCategory.map((c) => [c.name, c.totalUah, c.count])).toEqual([
      ["Groceries", 100.1, 1],
      ["Transport", 40, 1],
    ]);
  });

  it("DATA-02 / JOURNEY-3: the root layout's shell data never waits for NBU (rates stream separately)", async () => {
    const hanging = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", hanging);
    const shell = await getShellData();
    expect(shell).toMatchObject({ today: "2026-10-15", dataProblems: [] });
    expect(shell).not.toHaveProperty("rates");
    expect(hanging).not.toHaveBeenCalled();
  });

  it("REACT-7: a custom range from 1950 still loads the Spendings data", async () => {
    await spend("2026-10-02", 150, "Groceries");
    const old = await getExpensesPageData({ from: "1950-01-01", to: "2026-10-15" });
    expect(old.range).toEqual({ from: "1950-01-01", to: "2026-10-15" });
    expect(old.period.spendingUah).toBe(150);
  });
});

describe("today = 2027-01-10 (Q4 of the previous year is still being filed/paid)", () => {
  beforeEach(() => setup("2027-01-10T09:00:00Z"));

  it("freelance: upcoming deadlines get the previous year's statuses, independent of ?year", async () => {
    await earn("freelance", "2026-11-10", 100000);
    const data = await getFreelancePageData({});
    expect(data.year).toBe(2027);
    expect(data.paymentStatus.every((q) => q.period.startsWith("2027-"))).toBe(true);
    // Employed: no own ЄСВ, so the first deadline is the annual filing, not "Pay ЄСВ" on 19 Jan.
    expect(data.upcomingDeadlines[0]).toMatchObject({ kind: "filing", period: "2026-Q4", date: "2027-02-09" });
    expect(data.upcomingDeadlines.some((d) => d.kind === "esv")).toBe(false);
    const q4 = data.upcomingPaymentStatus.find((q) => q.period === "2026-Q4");
    expect(q4?.items.single_tax).toMatchObject({ due: 5000, paid: 0, overdue: false });
    expect(q4?.items.military_levy.due).toBe(1000);
  });

  it("“Pay ЄСВ” deadlines stay when own ЄСВ is owed (minimum mode) — on the Freelancer page and the Overview", async () => {
    expect((await updateSettings({ tax: { esvMode: "minimum" } })).ok).toBe(true);
    const fl = await getFreelancePageData({});
    expect(fl.upcomingDeadlines[0]).toMatchObject({ kind: "esv", period: "2026-Q4", date: "2027-01-19" });
    const ov = await getOverviewData();
    expect(ov.taxDeadlines[0]).toMatchObject({ kind: "esv", period: "2026-Q4", date: "2027-01-19" });
    expect(ov.taxDeadlines).toHaveLength(6);
  });
});

describe("today = 2026-10-15: Investments page sections", () => {
  beforeEach(() => setup("2026-10-15T09:00:00Z"));

  it("lists IBKR under Investments and the Deposits account under Bank deposits, each with subtotals", async () => {
    const data = await getInvestmentsPageData();
    expect(data.sections.map((x) => [x.group, x.summaries.map((y) => y.account.name)])).toEqual([
      ["ibkr", ["IBKR"]],
      ["deposits", ["Deposits"]],
    ]);
    expect(data.summaries.map((y) => y.account.name)).toEqual(["IBKR", "Deposits"]);
    expect(data.investmentAccounts.map((a) => a.name)).toEqual(["IBKR", "Deposits"]);
    expect(data.otherAccounts.some((a) => a.name === "Deposits")).toBe(false);
  });
});

describe("today = 2026-10-15: the optional ЄСВ preview (?esv=1)", () => {
  beforeEach(() => setup("2026-10-15T09:00:00Z"));

  it("adds the minimum ЄСВ as optional amounts and deadlines, never as due or overdue", async () => {
    await earn("freelance", "2026-05-10", 100000);
    const off = await getFreelancePageData({});
    expect(off.esvOptional).toEqual({ available: true, included: false, byQuarter: {} });
    expect(off.viewSettings.tax.esvMode).toBe("employed");
    expect(off.upcomingDeadlines.some((d) => d.kind === "esv")).toBe(false);

    const on = await getFreelancePageData({ esv: "1" });
    expect(on.esvOptional.included).toBe(true);
    expect(on.esvOptional.byQuarter["2026-Q3"]).toBe(5707.02);
    expect(on.viewSettings.tax.esvMode).toBe("minimum");
    expect(on.upcomingDeadlines[0]).toMatchObject({ kind: "esv", period: "2026-Q3", date: "2026-10-19" });
    // Real figures are untouched: no ЄСВ due, nothing overdue (Q1/Q2 ЄСВ deadlines have passed), same options.
    expect(on.paymentStatus.every((q) => q.items.esv.due === 0)).toBe(true);
    expect(on.overdue).toEqual(off.overdue);
    expect(on.overdue.some((o) => o.kind === "esv")).toBe(false);
    expect(on.paymentOptions).toEqual(off.paymentOptions);
    // The settings file still says "employed".
    expect((await readSnapshot()).settings.tax.esvMode).toBe("employed");
  });

  it("is not offered when the saved mode already includes ЄСВ", async () => {
    expect((await updateSettings({ tax: { esvMode: "minimum" } })).ok).toBe(true);
    const data = await getFreelancePageData({ esv: "1" });
    expect(data.esvOptional).toEqual({ available: false, included: false, byQuarter: {} });
    expect(data.viewSettings.tax.esvMode).toBe("minimum");
  });
});

describe("today = 2027-01-25 (TAX-1: last year's Q4 is the payment due)", () => {
  beforeEach(() => setup("2027-01-25T09:00:00Z"));

  it("freelance: Record tax payment offers and preselects 2026-Q4 on the default 2027 view", async () => {
    await earn("freelance", "2026-11-10", 200000);
    await earn("freelance", "2027-01-10", 50000);
    const data = await getFreelancePageData({});
    expect(data.year).toBe(2027);
    const periods = data.paymentOptions.map((o) => o.period);
    expect(periods).toContain("2026-Q4");
    expect(periods).toContain("2027-Q1");
    expect(defaultPaymentPeriod(data.paymentOptions)).toBe("2026-Q4");
    expect(data.paymentOptions.find((o) => o.period === "2026-Q4")?.items.single_tax.outstanding).toBe(10000);
    expect(data.overdue).toEqual([]);
  });
});

describe("today = 2027-03-01 (TAX-2: overdue from another year)", () => {
  beforeEach(() => setup("2027-03-01T09:00:00Z"));

  it("freelance + overview show last year's unpaid Q4 although the default view is 2027", async () => {
    await earn("freelance", "2026-11-10", 200000);
    const data = await getFreelancePageData({});
    expect(data.year).toBe(2027);
    expect(data.overdue.map((o) => [o.period, o.kind, o.outstanding])).toEqual([
      ["2026-Q4", "single_tax", 10000],
      ["2026-Q4", "military_levy", 2000],
    ]);
    const overview = await getOverviewData();
    expect(overview.taxOverdue).toEqual(data.overdue);
  });
});
