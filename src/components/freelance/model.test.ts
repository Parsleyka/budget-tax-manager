import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "@/lib/money";
import { upcomingDeadlines } from "@/lib/tax/deadlines";
import { calculateTaxes, declarationPaymentStatus, quarterlyDeclaration, summarizeTaxPayments } from "@/lib/tax/engine";
import { expense, income, taxSettings } from "@/test/factories";
import {
  buildPaymentLines,
  currencyTotals,
  daysLabel,
  deadlineOutstanding,
  defaultPaymentPeriod,
  describeQuarters,
  describeSelection,
  encodeMonthsParam,
  formatBp,
  inMonths,
  isQuarterEnded,
  itemStatus,
  levyPaymentNote,
  levySummary,
  overdueItems,
  parseMonthsParam,
  paymentQuarterOptions,
  pickNextDeadline,
  quarterStatus,
  selectionPayments,
} from "./model";

const TODAY = "2026-10-15";

describe("months URL param", () => {
  it("encodes consecutive runs as ranges", () => {
    expect(encodeMonthsParam(["2026-01", "2026-02", "2026-03", "2026-07"], 2026)).toBe("1-3,7");
    expect(encodeMonthsParam(["2026-10", "2026-12", "2026-11"], 2026)).toBe("10-12");
    expect(encodeMonthsParam(["2026-01", "2026-03", "2026-05"], 2026)).toBe("1,3,5");
    expect(encodeMonthsParam(["2026-04", "2026-05"], 2026)).toBe("4-5");
  });

  it("drops other years / invalid months and encodes empty as none", () => {
    expect(encodeMonthsParam(["2025-12", "2026-01", "2026-13", "nope"], 2026)).toBe("1");
    expect(encodeMonthsParam([], 2026)).toBe("none");
  });

  it("parses ranges, single months and none", () => {
    expect(parseMonthsParam("1-3,7", 2026)).toEqual(["2026-01", "2026-02", "2026-03", "2026-07"]);
    expect(parseMonthsParam(" 12, 10-11 ", 2025)).toEqual(["2025-10", "2025-11", "2025-12"]);
    expect(parseMonthsParam("none", 2026)).toEqual([]);
    expect(parseMonthsParam("NONE", 2026)).toEqual([]);
  });

  it("returns null when absent or unusable, skipping bad tokens", () => {
    expect(parseMonthsParam(undefined, 2026)).toBeNull();
    expect(parseMonthsParam("", 2026)).toBeNull();
    expect(parseMonthsParam("abc,0,13,5-2", 2026)).toBeNull();
    expect(parseMonthsParam("abc,4", 2026)).toEqual(["2026-04"]);
    expect(parseMonthsParam("1-13", 2026)).toBeNull();
  });

  it("round-trips", () => {
    const months = ["2026-02", "2026-03", "2026-04", "2026-09", "2026-11", "2026-12"];
    expect(parseMonthsParam(encodeMonthsParam(months, 2026), 2026)).toEqual(months);
  });
});

describe("selection helpers", () => {
  it("describes a selection", () => {
    expect(describeSelection([], 2026)).toBe("No months");
    expect(describeSelection(["2026-07", "2026-08", "2026-09"], 2026)).toBe("Q3 2026");
    expect(describeSelection(["2026-02", "2026-03", "2026-04"], 2026)).toBe("Feb – Apr 2026");
    expect(describeSelection(["2026-10"], 2026)).toBe("Oct 2026");
    expect(describeSelection(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], 2026)).toBe(
      "Jan – Oct 2026",
    );
    expect(describeSelection(["2026-01", "2026-03"], 2026)).toBe("2 months of 2026");
    expect(describeSelection(Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`), 2025)).toBe("Year 2025");
    expect(describeSelection(["2025-01"], 2026)).toBe("No months");
  });

  it("filters items by month", () => {
    const items = [{ date: "2026-01-31" }, { date: "2026-02-01" }, { date: "2026-03-15" }];
    expect(inMonths(items, ["2026-01", "2026-03"])).toEqual([items[0], items[2]]);
  });
});

describe("currencyTotals", () => {
  it("sums per currency before exchange (USD, EUR, UAH order) and the UAH total after", () => {
    const t = currencyTotals([
      income({ currency: "UAH", amount: 5000 }),
      income({ currency: "USD", amount: 1234.56, rate: 44.9801, fee: 10.5 }),
      income({ currency: "EUR", amount: 950, rate: 48.1234 }),
      income({ currency: "USD", amount: 0.1, rate: 44.9801, fee: 0.2 }),
    ]);
    expect(t.byCurrency.map((c) => c.currency)).toEqual(["USD", "EUR", "UAH"]);
    const usd = t.byCurrency[0];
    expect(usd.count).toBe(2);
    expect(usd.amount).toBe(1234.66); // exact, no float drift
    expect(usd.amountUah).toBe(55530.63 + 4.5);
    expect(usd.fee).toBe(10.7);
    expect(t.byCurrency[1].amountUah).toBe(45717.23);
    expect(t.totalUah).toBe(5000 + 55535.13 + 45717.23);
    expect(t.count).toBe(4);
  });

  it("is empty for no incomes", () => {
    expect(currencyTotals([])).toEqual({ byCurrency: [], totalUah: 0, count: 0 });
  });
});

describe("rate labels", () => {
  it("formats basis points", () => {
    expect(formatBp(500)).toBe("5%");
    expect(formatBp(300)).toBe("3%");
    expect(formatBp(550)).toBe("5,5%");
    expect(formatBp(125)).toBe("1,25%");
  });

  it("summarises the military levy for the selection", () => {
    expect(levySummary(["2026-01", "2026-02"], taxSettings())).toEqual({ label: "1%", note: "of all income" });
    expect(levySummary(["2024-11", "2024-12"], taxSettings()).label).toBe("0%");
    expect(levySummary(["2024-11", "2024-12"], taxSettings()).note).toMatch(/before 2025/);
    expect(levySummary(["2024-12", "2025-01"], taxSettings()).label).toBe("0–1%");
    expect(levySummary(["2026-01"], taxSettings({ militaryLevyEnabled: false }))).toEqual({ label: "off", note: "Disabled in Settings" });
    expect(levySummary(["2026-01"], taxSettings({ militaryLevyRateOverridePct: 2 })).label).toBe("2%");
    expect(levySummary(["2026-05"], taxSettings({ militaryLevyEndDate: "2026-03-31" })).note).toMatch(/ended 31 Mar 2026/);
    expect(levySummary([], taxSettings()).label).toBe("1%");
  });
});

describe("payment status", () => {
  const settings = taxSettings({ esvMode: "minimum" });
  const incomes = [
    income({ date: "2026-02-10", amount: 100000 }),
    income({ date: "2026-05-10", amount: 50000 }),
    income({ date: "2026-08-10", amount: 20000 }),
    income({ date: "2026-10-05", amount: 10000 }),
  ];
  const decl = quarterlyDeclaration(2026, { incomes, settings });
  const payments = summarizeTaxPayments([
    expense({ amount: 5000, taxMeta: { kind: "single_tax", period: "2026-Q1" } }),
    expense({ amount: 1000, taxMeta: { kind: "military_levy", period: "2026-Q1" } }),
    expense({ amount: 5707.02, taxMeta: { kind: "esv", period: "2026-Q1" } }),
    expense({ amount: 1000, taxMeta: { kind: "single_tax", period: "2026-Q2" } }),
  ]);
  const statuses = declarationPaymentStatus(decl, payments, TODAY);

  it("labels quarters", () => {
    expect(quarterStatus(statuses[0], TODAY)).toEqual({ label: "Paid", tone: "positive" });
    expect(quarterStatus(statuses[1], TODAY)).toEqual({ label: "Overdue", tone: "negative" });
    // Q3 ended; ЄСВ (19 Oct) is the nearest outstanding deadline.
    expect(quarterStatus(statuses[2], TODAY)).toEqual({ label: "Due in 4 days", tone: "warning" });
    expect(quarterStatus(statuses[3], TODAY)).toEqual({ label: "In progress", tone: "info" });
    expect(isQuarterEnded("2026-Q3", TODAY)).toBe(true);
    expect(isQuarterEnded("2026-Q4", TODAY)).toBe(false);
  });

  it("labels items", () => {
    expect(itemStatus(statuses[0].items.single_tax, true)).toEqual({ label: "Paid", tone: "positive" });
    expect(itemStatus(statuses[1].items.single_tax, true)).toEqual({ label: "Overdue · partly paid", tone: "negative" });
    expect(itemStatus(statuses[1].items.esv, true)).toEqual({ label: "Overdue", tone: "negative" });
    expect(itemStatus(statuses[2].items.single_tax, true)).toEqual({ label: "Due in 35 days", tone: "warning" });
    expect(itemStatus(statuses[3].items.single_tax, false)).toEqual({ label: "Accruing", tone: "info" });
    const nothing = { ...statuses[0].items.esv, state: "nothing-due" as const };
    expect(itemStatus(nothing, true).label).toBe("Nothing due");
  });

  it("collects overdue items", () => {
    const o = overdueItems(statuses);
    expect(o.map((x) => `${x.period}:${x.kind}`)).toEqual(["2026-Q2:single_tax", "2026-Q2:military_levy", "2026-Q2:esv"]);
    expect(o[0].outstanding).toBe(1500); // 5% of 50 000 − 1 000 paid
    expect(o[0].deadline).toBe("2026-08-19");
  });

  it("finds outstanding per deadline and the next actionable deadline", () => {
    const upcoming = upcomingDeadlines(TODAY);
    expect(upcoming[0]).toMatchObject({ kind: "esv", period: "2026-Q3", date: "2026-10-19" });
    expect(deadlineOutstanding(upcoming[0], statuses)).toEqual({ outstanding: 5707.02, due: 5707.02 });
    expect(pickNextDeadline(upcoming, statuses)).toMatchObject({ kind: "esv", period: "2026-Q3" });

    // ЄСВ already paid → the next action is filing the 9-month declaration.
    const paid = declarationPaymentStatus(
      decl,
      { ...payments, "2026-Q3": { single_tax: 0, military_levy: 0, esv: 5707.02 } },
      TODAY,
    );
    expect(pickNextDeadline(upcoming, paid)).toMatchObject({ kind: "filing", period: "2026-Q3", date: "2026-11-09" });
    expect(deadlineOutstanding({ kind: "filing", period: "2026-Q3" }, paid)).toBeNull();
    // Unknown period (another year) counts as actionable.
    expect(pickNextDeadline([{ kind: "payment", period: "2025-Q4", year: 2025, quarter: 4, date: "2026-02-19", label: "x" }], paid)).not.toBeNull();
    expect(pickNextDeadline([], paid)).toBeNull();
  });

  it("builds payment options and picks the default period", () => {
    const opts = paymentQuarterOptions(decl, statuses, TODAY);
    expect(opts.map((o) => o.label)).toEqual([
      "Q1 2026 · Q1 declaration",
      "Q2 2026 · Half-year declaration",
      "Q3 2026 · 9-month declaration",
      "Q4 2026 · Annual declaration",
    ]);
    expect(opts[1].items.single_tax).toEqual({ due: 2500, paid: 1000, outstanding: 1500 });
    expect(opts[2].paymentDeadline).toBe("2026-11-19");
    expect(opts[2].esvDeadline).toBe("2026-10-19");
    expect(defaultPaymentPeriod(opts)).toBe("2026-Q2");

    const allPaid = opts.map((o) => ({
      ...o,
      items: {
        single_tax: { ...o.items.single_tax, outstanding: 0 },
        military_levy: { ...o.items.military_levy, outstanding: 0 },
        esv: { ...o.items.esv, outstanding: 0 },
      },
    }));
    expect(defaultPaymentPeriod(allPaid)).toBe("2026-Q3");
    expect(defaultPaymentPeriod(allPaid.map((o) => ({ ...o, ended: false })))).toBe("2026-Q1");
    expect(defaultPaymentPeriod([])).toBeNull();
  });
});

describe("buildPaymentLines", () => {
  it("returns checked lines in kind order and flags bad amounts", () => {
    const r = buildPaymentLines(
      [
        { kind: "esv", checked: true, amount: "5 707,02" },
        { kind: "single_tax", checked: true, amount: "1000" },
        { kind: "military_levy", checked: false, amount: "abc" },
      ],
      parseMoneyInput,
    );
    expect(r.payments).toEqual([
      { kind: "single_tax", amount: 1000 },
      { kind: "esv", amount: 5707.02 },
    ]);
    expect(r.errors).toEqual({});
    expect(r.formError).toBeNull();

    const bad = buildPaymentLines(
      [
        { kind: "single_tax", checked: true, amount: "0" },
        { kind: "esv", checked: true, amount: "1,234" },
      ],
      parseMoneyInput,
    );
    expect(Object.keys(bad.errors).sort()).toEqual(["esv", "single_tax"]);
    expect(bad.payments).toEqual([]);

    expect(buildPaymentLines([{ kind: "esv", checked: false, amount: "1" }], parseMoneyInput).formError).toMatch(/at least one/);
  });

  it("reminds about the new levy budget code in H2 2026 only", () => {
    expect(levyPaymentNote("2026-08-19")).toMatch(/11011700/);
    expect(levyPaymentNote("2026-06-30")).toBeNull();
    expect(levyPaymentNote("2027-01-05")).toBeNull();
  });
});

describe("daysLabel", () => {
  it("reads naturally", () => {
    expect([0, 1, -1, 5, -3].map(daysLabel)).toEqual(["today", "tomorrow", "yesterday", "in 5 days", "3 days ago"]);
  });
});

describe("JOURNEY-7: paid vs outstanding for the selected months", () => {
  const employed = taxSettings({ esvMode: "employed" });
  const incomes = [
    income({ kind: "freelance", date: "2026-02-10", amount: 100_000, currency: "UAH", rate: 1 }),
    income({ kind: "freelance", date: "2026-05-10", amount: 100_000, currency: "UAH", rate: 1 }),
    income({ kind: "freelance", date: "2026-08-10", amount: 100_000, currency: "UAH", rate: 1 }),
    income({ kind: "freelance", date: "2026-10-05", amount: 20_000, currency: "UAH", rate: 1 }),
  ];
  const paidQ = (q: number) => [
    expense({ amount: 5000, taxMeta: { kind: "single_tax", period: `2026-Q${q}` } }),
    expense({ amount: 1000, taxMeta: { kind: "military_levy", period: `2026-Q${q}` } }),
  ];
  const decl = quarterlyDeclaration(2026, { incomes, settings: employed });
  const statuses = declarationPaymentStatus(decl, summarizeTaxPayments([...paidQ(1), ...paidQ(2), ...paidQ(3)]), TODAY);
  const ytd = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

  it("the selection total is an accrual; what is left after recorded payments is much less", () => {
    expect(calculateTaxes({ incomes, months: ytd, settings: employed }).totals.total).toBe(19_200);
    expect(selectionPayments(statuses, ytd)).toEqual({
      periods: ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"],
      label: "Q1–Q4 2026",
      due: 19_200,
      paid: 18_000,
      outstanding: 1_200,
    });
  });

  it("covers only the quarters touched by the selection (credit from earlier quarters counts as paid)", () => {
    expect(selectionPayments(statuses, ["2026-08"])).toMatchObject({ label: "Q3 2026", due: 6000, paid: 6000, outstanding: 0 });
    const credit = declarationPaymentStatus(
      decl,
      summarizeTaxPayments([expense({ amount: 10_000, taxMeta: { kind: "single_tax", period: "2026-Q1" } })]),
      TODAY,
    );
    expect(selectionPayments(credit, ["2026-04", "2026-05", "2026-06"])).toMatchObject({ paid: 5000, outstanding: 1000 });
    expect(selectionPayments(statuses, [])).toBeNull();
  });

  it("describes quarters compactly", () => {
    expect(describeQuarters(["2026-Q3"])).toBe("Q3 2026");
    expect(describeQuarters(["2026-Q2", "2026-Q1", "2026-Q3", "2026-Q2"])).toBe("Q1–Q3 2026");
    expect(describeQuarters(["2026-Q1", "2026-Q3"])).toBe("Q1, Q3 2026");
    expect(describeQuarters(["2026-Q1", "2025-Q4"])).toBe("Q4 2025, Q1 2026");
  });
});
