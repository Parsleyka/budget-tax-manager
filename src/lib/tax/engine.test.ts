import { describe, expect, it } from "vitest";
import { expense, income, settings, taxSettings } from "@/test/factories";
import type { Income } from "../types";
import {
  calculateTaxes,
  declarationPaymentStatus,
  esvForMonth,
  inMilitaryService,
  limitStatus,
  quarterlyDeclaration,
  splitByLimit,
  summarizeTaxPayments,
  yearToDateMonths,
} from "./engine";

const fl = (date: string, amountUah: number, over: Partial<Income> = {}) =>
  income({ kind: "freelance", date, amount: amountUah, currency: "UAH", rate: 1, ...over });

const minimum = taxSettings({ esvMode: "minimum" });
const exempt = taxSettings({ esvMode: "exempt" });

describe("single tax rates", () => {
  it("5% by default, levy 1% (2026), minimum ЄСВ", () => {
    const r = calculateTaxes({ incomes: [fl("2026-01-20", 100000)], months: ["2026-01"], settings: minimum });
    expect(r.totals).toMatchObject({ incomeUah: 100000, singleTax: 5000, levy: 1000, esv: 1902.34, total: 7902.34 });
    expect(r.totals.effectiveRate).toBeCloseTo(0.0790234, 10);
    expect(r.totals.effectiveRateExclEsv).toBeCloseTo(0.06, 10);
    expect(r.singleTaxRateBp).toBe(500);
    expect(r.rows[0]).toMatchObject({ month: "2026-01", label: "Jan 2026", singleTax: 5000, levy: 1000, esv: 1902.34, incomeCount: 1 });
  });
  it("3% for a VAT payer", () => {
    const r = calculateTaxes({ incomes: [fl("2026-01-20", 100000)], months: ["2026-01"], settings: taxSettings({ vatPayer: true, esvMode: "exempt" }) });
    expect(r.totals.singleTax).toBe(3000);
    expect(r.singleTaxRateBp).toBe(300);
  });
  it("rate override", () => {
    const r = calculateTaxes({
      incomes: [fl("2026-01-20", 100000)],
      months: ["2026-01"],
      settings: taxSettings({ singleTaxRateOverridePct: 4.5, esvMode: "exempt" }),
    });
    expect(r.totals.singleTax).toBe(4500);
  });
  it("accepts a full Settings object and ignores salary", () => {
    const r = calculateTaxes({
      incomes: [fl("2026-02-01", 1000), income({ kind: "salary", date: "2026-02-05", amount: 50000 })],
      months: ["2026-02"],
      settings: settings({}, { esvMode: "exempt" }),
    });
    expect(r.totals.incomeUah).toBe(1000);
    expect(r.totals.singleTax).toBe(50);
  });
  it("FX income uses the stored UAH equivalent", () => {
    const usd = income({ kind: "freelance", date: "2026-10-09", currency: "USD", amount: 1234.56, rate: 44.8526 });
    const r = calculateTaxes({ incomes: [usd], months: ["2026-10"], settings: exempt });
    expect(usd.amountUah).toBe(55373.23); // 1234.56 × 44.8526 = 55 373.225856
    expect(r.totals.singleTax).toBe(2768.66); // 2 768.6615
    expect(r.totals.levy).toBe(553.73); // 553.7323
  });
});

describe("military levy", () => {
  it("0 in 2024, 1% from 2025-01-01", () => {
    const incomes = [fl("2024-12-31", 10000), fl("2025-01-01", 10000)];
    const r = calculateTaxes({ incomes, months: ["2024-12", "2025-01"], settings: exempt });
    expect(r.rows.map((x) => x.levy)).toEqual([0, 100]);
    expect(r.totals.levy).toBe(100);
    expect(r.rulesAssumed).toBe(false);
  });
  it("disabled / ended", () => {
    const incomes = [fl("2026-03-01", 10000)];
    expect(calculateTaxes({ incomes, months: ["2026-03"], settings: taxSettings({ esvMode: "exempt", militaryLevyEnabled: false }) }).totals.levy).toBe(0);
    expect(calculateTaxes({ incomes, months: ["2026-03"], settings: taxSettings({ esvMode: "exempt", militaryLevyEndDate: "2026-02-28" }) }).totals.levy).toBe(0);
  });
});

describe("rounding: once per aggregate", () => {
  it("selection total is rounded once, rows individually", () => {
    const r = calculateTaxes({ incomes: [fl("2026-01-10", 0.1), fl("2026-02-10", 0.1)], months: ["2026-01", "2026-02"], settings: exempt });
    expect(r.rows.map((x) => x.singleTax)).toEqual([0.01, 0.01]); // 0.005 → 0.01 each
    expect(r.totals.singleTax).toBe(0.01); // 0.20 × 5% = 0.01
  });
  it("quarter subtotals", () => {
    const r = calculateTaxes({
      incomes: [fl("2026-01-10", 1000), fl("2026-04-10", 2000)],
      months: ["2026-01", "2026-02", "2026-04"],
      settings: minimum,
    });
    expect(r.quarters.map((q) => [q.period, q.months, q.singleTax, q.esv])).toEqual([
      ["2026-Q1", ["2026-01", "2026-02"], 50, 3804.68],
      ["2026-Q2", ["2026-04"], 100, 1902.34],
    ]);
  });
  it("de-duplicates and sorts months, ignores invalid ones", () => {
    const r = calculateTaxes({ incomes: [], months: ["2026-03", "2026-01", "2026-03", "nope"], settings: minimum });
    expect(r.months).toEqual(["2026-01", "2026-03"]);
    expect(r.totals.esv).toBe(3804.68);
    expect(r.totals.effectiveRate).toBeNull();
  });
});

describe("income limit", () => {
  // 2026 limit = 10 091 049.00
  const incomes = [fl("2026-01-15", 10_000_000), fl("2026-02-10", 200_000), fl("2026-05-05", 50_000)];

  it("splits the crossing entry into within + excess", () => {
    const s = splitByLimit(incomes, 2026);
    expect(s.map((x) => [x.withinUah, x.excessUah, x.cumulativeUah])).toEqual([
      [10_000_000, 0, 10_000_000],
      [91_049, 108_951, 10_200_000],
      [0, 50_000, 10_250_000],
    ]);
  });
  it("taxes the excess at 15% (+ levy on everything)", () => {
    const r = calculateTaxes({ incomes, months: ["2026-02"], settings: exempt });
    // 91 049 × 5% + 108 951 × 15% = 4 552.45 + 16 342.65
    expect(r.totals.singleTax).toBe(20895.1);
    expect(r.totals.levy).toBe(2000);
    expect(r.rows[0]).toMatchObject({ withinUah: 91049, excessUah: 108951, afterForcedSwitch: false });
  });
  it("limit status, crossing and forced switch", () => {
    const l = limitStatus(incomes, 2026);
    expect(l).toMatchObject({
      year: 2026,
      limit: 10091049,
      incomeUah: 10_250_000,
      remainingUah: 0,
      exceeded: true,
      level: "exceeded",
      crossingDate: "2026-02-10",
      crossingMonth: "2026-02",
      crossingQuarter: "2026-Q1",
      forcedSwitchFrom: "2026-04-01",
      applicationDueBy: "2026-04-20",
      rulesAssumed: false,
    });
    const r = calculateTaxes({ incomes, months: ["2026-02", "2026-05"], settings: exempt });
    expect(r.rows.find((x) => x.month === "2026-05")?.afterForcedSwitch).toBe(true);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(["general-system", "limit-exceeded"]);
    expect(r.warnings.find((w) => w.code === "limit-exceeded")?.severity).toBe("critical");
  });
  it("income exactly equal to the limit is fully within", () => {
    const exact = [fl("2026-03-01", 10_091_049)];
    const s = splitByLimit(exact, 2026);
    expect(s[0]).toMatchObject({ withinUah: 10_091_049, excessUah: 0 });
    const l = limitStatus(exact, 2026);
    expect(l).toMatchObject({ exceeded: false, level: "reached", crossingDate: null, forcedSwitchFrom: null, remainingUah: 0, pct: 1 });
    // the first kopeck above is excess
    const over = splitByLimit([...exact, fl("2026-03-02", 0.01)], 2026);
    expect(over[1]).toMatchObject({ withinUah: 0, excessUah: 0.01 });
  });
  it("YTD includes months not selected; warnings at 80/90%", () => {
    const at85 = [fl("2026-01-10", 8_600_000), fl("2026-06-10", 1000)];
    const r = calculateTaxes({ incomes: at85, months: ["2026-06"], settings: exempt });
    expect(r.limits[0].incomeUah).toBe(8_601_000);
    expect(r.limits[0].incomeThroughSelectionUah).toBe(8_601_000);
    expect(r.limits[0].level).toBe("80");
    expect(r.warnings.map((w) => w.code)).toEqual(["limit-80"]);
    const at95 = calculateTaxes({ incomes: [fl("2026-01-10", 9_600_000)], months: ["2026-01"], settings: exempt });
    expect(at95.limits[0].level).toBe("90");
    const r2 = calculateTaxes({ incomes: at85, months: ["2026-01"], settings: exempt });
    expect(r2.limits[0].incomeThroughSelectionUah).toBe(8_600_000);
  });
  it("limit is per calendar year", () => {
    const l = limitStatus([fl("2025-12-31", 9_000_000), fl("2026-01-01", 100)], 2026);
    expect(l.incomeUah).toBe(100);
    expect(limitStatus([fl("2025-06-01", 9_336_000)], 2025).level).toBe("reached");
  });
});

describe("quarterly declaration (cumulative)", () => {
  it("payable = difference of rounded cumulative accruals", () => {
    const incomes = [fl("2026-02-01", 33.33), fl("2026-05-01", 33.33), fl("2026-08-01", 33.33)];
    const d = quarterlyDeclaration(2026, { incomes, settings: exempt });
    // cumulative: 33.33 → 1.6665 → 1.67 ; 66.66 → 3.333 → 3.33 ; 99.99 → 4.9995 → 5.00
    expect(d.quarters.map((q) => q.accruedSingleTax)).toEqual([1.67, 3.33, 5.0, 5.0]);
    expect(d.quarters.map((q) => q.payableSingleTax)).toEqual([1.67, 1.66, 1.67, 0]);
    expect(d.totals.singleTax).toBe(5.0);
    // independent per-quarter rounding would give 1.67 × 3 = 5.01
    const sum = d.quarters.reduce((s, q) => s + Math.round(q.payableSingleTax * 100), 0) / 100;
    expect(sum).toBe(d.totals.singleTax);
  });
  it("tiny amounts: 0.10 per quarter", () => {
    const incomes = [fl("2026-01-05", 0.1), fl("2026-04-05", 0.1), fl("2026-07-05", 0.1)];
    const d = quarterlyDeclaration(2026, { incomes, settings: exempt });
    expect(d.quarters.map((q) => q.accruedSingleTax)).toEqual([0.01, 0.01, 0.02, 0.02]);
    expect(d.quarters.map((q) => q.payableSingleTax)).toEqual([0.01, 0, 0.01, 0]);
  });
  it("levy accrues cumulatively too; ЄСВ per quarter; deadlines attached", () => {
    const incomes = [fl("2026-01-10", 100000), fl("2026-07-10", 50000.5)];
    const d = quarterlyDeclaration(2026, { incomes, settings: minimum });
    expect(d.quarters.map((q) => q.cumulativeIncomeUah)).toEqual([100000, 100000, 150000.5, 150000.5]);
    expect(d.quarters.map((q) => q.accruedLevy)).toEqual([1000, 1000, 1500.01, 1500.01]);
    expect(d.quarters.map((q) => q.payableLevy)).toEqual([1000, 0, 500.01, 0]);
    expect(d.quarters.map((q) => q.esv)).toEqual([5707.02, 5707.02, 5707.02, 5707.02]);
    expect(d.quarters[0].totalPayable).toBe(5000 + 1000 + 5707.02);
    expect(d.quarters[2].deadlines).toMatchObject({ filing: "2026-11-09", payment: "2026-11-19", esv: "2026-10-19" });
    expect(d.totals).toMatchObject({ incomeUah: 150000.5, singleTax: 7500.03, levy: 1500.01, esv: 22828.08 });
    expect(d.totals.total).toBe(31828.12);
  });
  it("2024: no levy", () => {
    const d = quarterlyDeclaration(2024, { incomes: [fl("2024-05-01", 100000)], settings: minimum });
    expect(d.totals.levy).toBe(0);
    expect(d.totals.singleTax).toBe(5000);
    expect(d.quarters[0].esv).toBe(4686);
  });
});

describe("ЄСВ modes", () => {
  it("employed: covered window → 0; outside / uncovered → minimum", () => {
    const tax = taxSettings({
      esvMode: "employed",
      employedFrom: "2026-03-15",
      employedTo: "2026-08-10",
      esvUncoveredMonths: ["2026-05"],
    });
    expect(esvForMonth("2026-02", tax)).toMatchObject({ amount: 1902.34, reason: "outside-employment" });
    expect(esvForMonth("2026-03", tax)).toMatchObject({ amount: 0, reason: "employed", base: null });
    expect(esvForMonth("2026-04", tax)).toMatchObject({ amount: 0, reason: "employed" });
    expect(esvForMonth("2026-05", tax)).toMatchObject({ amount: 1902.34, reason: "uncovered", base: 8647 });
    expect(esvForMonth("2026-08", tax)).toMatchObject({ amount: 0, reason: "employed" });
    expect(esvForMonth("2026-09", tax)).toMatchObject({ amount: 1902.34, reason: "outside-employment" });
  });
  it("employed with an unbounded window covers every month", () => {
    const tax = taxSettings({ esvMode: "employed" });
    const r = calculateTaxes({ incomes: [fl("2026-01-10", 1000)], months: ["2026-01", "2026-02", "2026-03"], settings: tax });
    expect(r.totals.esv).toBe(0);
    expect(r.rows.every((x) => x.esvReason === "employed")).toBe(true);
  });
  it("minimum", () => {
    expect(esvForMonth("2025-06", minimum)).toMatchObject({ amount: 1760, reason: "minimum", base: 8000, minimumWage: 8000 });
  });
  it("custom base is clamped to [МЗП, max base]", () => {
    const custom = (base: number) => taxSettings({ esvMode: "custom", esvCustomMonthlyBase: base });
    expect(esvForMonth("2026-06", custom(5000))).toMatchObject({ amount: 1902.34, base: 8647, reason: "custom" });
    expect(esvForMonth("2026-06", custom(50000))).toMatchObject({ amount: 11000, base: 50000 });
    expect(esvForMonth("2026-06", custom(500000))).toMatchObject({ amount: 38046.8, base: 172940 });
    expect(esvForMonth("2024-02", custom(500000))).toMatchObject({ amount: 23430, base: 106500 });
    expect(esvForMonth("2026-06", taxSettings({ esvMode: "custom", esvCustomMonthlyBase: null }))).toMatchObject({ amount: 1902.34 });
  });
  it("exempt", () => {
    expect(esvForMonth("2026-06", exempt)).toMatchObject({ amount: 0, reason: "exempt" });
  });
  it("no ЄСВ before the registration month; full minimum for the registration month", () => {
    const tax = taxSettings({ esvMode: "minimum", fopRegisteredOn: "2026-03-10" });
    expect(esvForMonth("2026-02", tax)).toMatchObject({ amount: 0, reason: "before-registration" });
    expect(esvForMonth("2026-03", tax)).toMatchObject({ amount: 1902.34, reason: "minimum" });
  });
});

describe("warnings", () => {
  it("rulesAssumed for 2027 (last known values reused)", () => {
    const r = calculateTaxes({ incomes: [fl("2027-01-10", 1000)], months: ["2027-01"], settings: minimum });
    expect(r.rulesAssumed).toBe(true);
    expect(r.limits[0]).toMatchObject({ limit: 10091049, rulesAssumed: true });
    expect(r.rows[0].esv).toBe(1902.34);
    expect(r.warnings.map((w) => w.code)).toContain("rules-assumed");
  });
  it("income before registration", () => {
    const tax = taxSettings({ esvMode: "exempt", fopRegisteredOn: "2026-03-10" });
    const r = calculateTaxes({ incomes: [fl("2026-03-05", 1000), fl("2026-03-12", 1000)], months: ["2026-03"], settings: tax });
    const w = r.warnings.find((x) => x.code === "income-before-registration");
    expect(w?.message).toMatch(/^1 freelance income/);
  });
});

describe("payments vs due", () => {
  it("summarizes tax payments and derives status", () => {
    const incomes = [fl("2026-01-10", 100000), fl("2026-04-10", 100000)];
    const d = quarterlyDeclaration(2026, { incomes, settings: minimum });
    const expenses = [
      expense({ amount: 5000, taxMeta: { kind: "single_tax", period: "2026-Q1" } }),
      expense({ amount: 1000, taxMeta: { kind: "military_levy", period: "2026-Q1" } }),
      expense({ amount: 5707.02, taxMeta: { kind: "esv", period: "2026-Q1" } }),
      expense({ amount: 2000, taxMeta: { kind: "single_tax", period: "2026-Q2" } }),
      expense({ amount: 999 }), // not a tax payment
    ];
    const paid = summarizeTaxPayments(expenses);
    expect(paid["2026-Q1"]).toEqual({ single_tax: 5000, military_levy: 1000, esv: 5707.02 });
    expect(paid["2026-Q2"]).toEqual({ single_tax: 2000, military_levy: 0, esv: 0 });
    const status = declarationPaymentStatus(d, paid, "2026-10-15");
    expect(status[0].items.single_tax).toMatchObject({ state: "paid", outstanding: 0, overdue: false });
    expect(status[0].outstanding).toBe(0);
    expect(status[1].items.single_tax).toMatchObject({ due: 5000, paid: 2000, outstanding: 3000, state: "partial", overdue: true });
    expect(status[1].items.military_levy).toMatchObject({ state: "unpaid", overdue: true, deadline: "2026-08-19" });
    expect(status[2].items.single_tax).toMatchObject({ state: "nothing-due", due: 0 });
    expect(status[2].items.esv).toMatchObject({ state: "unpaid", overdue: false, deadline: "2026-10-19", daysLeft: 4 });
  });
});

describe("month presets", () => {
  it("yearToDateMonths", () => {
    expect(yearToDateMonths(2026, "2026-10-15")).toHaveLength(10);
    expect(yearToDateMonths(2025, "2026-10-15")).toHaveLength(12);
    expect(yearToDateMonths(2027, "2026-10-15")).toEqual([]);
  });
});

// ------------------------------------------------------------------ review fixes

describe("TAX-3: an advance / overpayment is carried forward within the year", () => {
  it("a whole year of ЄСВ recorded for Q1 covers Q2–Q4 (no false Overdue)", () => {
    const d = quarterlyDeclaration(2026, { incomes: [], settings: minimum });
    const paid = summarizeTaxPayments([expense({ amount: 22828.08, taxMeta: { kind: "esv", period: "2026-Q1" } })]);
    const st = declarationPaymentStatus(d, paid, "2026-10-25");
    expect(st[0].items.esv).toMatchObject({ due: 5707.02, paid: 22828.08, state: "overpaid", outstanding: 0, carriedForward: 17121.06 });
    expect(st[1].items.esv).toMatchObject({ paid: 0, creditApplied: 5707.02, outstanding: 0, state: "paid", overdue: false });
    expect(st[2].items.esv).toMatchObject({ creditApplied: 5707.02, outstanding: 0, state: "paid", overdue: false });
    expect(st[3].items.esv).toMatchObject({ creditApplied: 5707.02, outstanding: 0, state: "paid", carriedForward: 0 });
    expect(st.every((q) => q.outstanding === 0)).toBe(true);
  });
  it("a partial credit reduces the next quarter; credit never crosses tax kinds", () => {
    const d = quarterlyDeclaration(2026, { incomes: [fl("2026-01-10", 100000), fl("2026-04-10", 100000)], settings: exempt });
    const paid = summarizeTaxPayments([
      expense({ amount: 7000, taxMeta: { kind: "single_tax", period: "2026-Q1" } }), // 2 000 over Q1's 5 000
      expense({ amount: 1000, taxMeta: { kind: "military_levy", period: "2026-Q1" } }),
    ]);
    const st = declarationPaymentStatus(d, paid, "2026-10-15");
    expect(st[0].items.single_tax).toMatchObject({ state: "overpaid", carriedForward: 2000 });
    expect(st[1].items.single_tax).toMatchObject({ due: 5000, creditApplied: 2000, outstanding: 3000, state: "partial", overdue: true });
    expect(st[1].items.military_levy).toMatchObject({ due: 1000, creditApplied: 0, outstanding: 1000, state: "unpaid" });
  });
  it("credit does not cross into the next year", () => {
    const paid = summarizeTaxPayments([expense({ amount: 30000, taxMeta: { kind: "esv", period: "2025-Q4" } })]);
    const st2026 = declarationPaymentStatus(quarterlyDeclaration(2026, { incomes: [], settings: minimum }), paid, "2026-10-25");
    expect(st2026[0].items.esv).toMatchObject({ creditApplied: 0, outstanding: 5707.02, overdue: true });
  });
});

describe("TAX-4: no single tax / levy after the forced switch to the general system", () => {
  const incomes = [
    fl("2026-03-10", 5_000_000),
    fl("2026-06-10", 4_150_000),
    fl("2026-08-20", 1_044_456.29), // crosses the 10 091 049 limit in Q3
    fl("2026-10-05", 10_000),
  ];
  it("Q4 accrues nothing and is flagged; ЄСВ still applies", () => {
    const d = quarterlyDeclaration(2026, { incomes, settings: minimum });
    expect(d.limit.forcedSwitchFrom).toBe("2026-10-01");
    expect(d.quarters.map((q) => q.afterForcedSwitch)).toEqual([false, false, false, true]);
    expect(d.quarters[3]).toMatchObject({ incomeUah: 10_000, payableSingleTax: 0, payableLevy: 0, esv: 5707.02 });
    expect(d.quarters[3].accruedSingleTax).toBe(d.quarters[2].accruedSingleTax);
    // Q3 still taxes the excess at 15%.
    expect(d.quarters[2].excessCumulativeUah).toBe(103407.29);
    const st = declarationPaymentStatus(d, {}, "2027-03-01");
    expect(st[3].items.single_tax).toMatchObject({ state: "nothing-due", overdue: false });
    expect(st[3].items.military_levy).toMatchObject({ state: "nothing-due", overdue: false });
  });
  it("the month-by-month calculator agrees with the declaration after the switch", () => {
    const calc = calculateTaxes({ incomes, months: ["2026-08", "2026-10"], settings: minimum });
    const oct = calc.rows.find((r) => r.month === "2026-10");
    expect(oct).toMatchObject({ afterForcedSwitch: true, incomeUah: 10_000, singleTax: 0, levy: 0, esv: 1902.34 });
    expect(calc.rows.find((r) => r.month === "2026-08")).toMatchObject({ afterForcedSwitch: false });
    const d = quarterlyDeclaration(2026, { incomes, settings: minimum });
    const all = calculateTaxes({ incomes, months: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"], settings: minimum });
    expect(all.totals.singleTax).toBe(d.totals.singleTax);
    expect(all.totals.levy).toBe(d.totals.levy);
  });
  it("without crossing the limit nothing changes", () => {
    const d = quarterlyDeclaration(2026, { incomes: [fl("2026-10-05", 10_000)], settings: exempt });
    expect(d.quarters[3]).toMatchObject({ afterForcedSwitch: false, payableSingleTax: 500, payableLevy: 100 });
  });
});

describe("TAX-5: time-limited ЄСВ rules", () => {
  it("2024 opt-out (п. 9-19) zeroes 2024 months only", () => {
    const tax = taxSettings({ esvMode: "minimum", esv2024OptOut: true });
    expect(esvForMonth("2024-03", tax)).toMatchObject({ amount: 0, reason: "opt-out-2024" });
    expect(esvForMonth("2025-01", tax)).toMatchObject({ amount: 1760, reason: "minimum" });
    const d = quarterlyDeclaration(2024, { incomes: [fl("2024-05-01", 100000)], settings: tax });
    expect(d.quarters.map((q) => q.esv)).toEqual([0, 0, 0, 0]);
    expect(declarationPaymentStatus(d, { "2024-Q2": { single_tax: 5000, military_levy: 0, esv: 0 } }, "2026-10-15").every((q) => q.outstanding === 0)).toBe(true);
    // also in employed mode outside the employment window
    const employed = taxSettings({ esvMode: "employed", employedFrom: "2025-01-01", esv2024OptOut: true });
    expect(esvForMonth("2024-06", employed)).toMatchObject({ amount: 0, reason: "opt-out-2024" });
  });
  it("exempt periods (inclusive month ranges, open-ended allowed)", () => {
    const tax = taxSettings({
      esvMode: "minimum",
      esvExemptPeriods: [
        { from: "2025-03", to: "2025-05", note: "Military service" },
        { from: "2026-09", to: null },
      ],
    });
    expect(esvForMonth("2025-02", tax)).toMatchObject({ amount: 1760, reason: "minimum" });
    expect(esvForMonth("2025-03", tax)).toMatchObject({ amount: 0, reason: "exempt-period" });
    expect(esvForMonth("2025-05", tax)).toMatchObject({ amount: 0, reason: "exempt-period" });
    expect(esvForMonth("2025-06", tax)).toMatchObject({ amount: 1760, reason: "minimum" });
    expect(esvForMonth("2027-01", tax)).toMatchObject({ amount: 0, reason: "exempt-period" });
    expect(quarterlyDeclaration(2025, { incomes: [], settings: tax }).quarters.map((q) => q.esv)).toEqual([3520, 1760, 5280, 5280]); // Mar, Apr, May exempt
  });
  it("no ЄСВ after the deregistration month (the month itself is owed)", () => {
    const tax = taxSettings({ esvMode: "minimum", fopDeregisteredOn: "2026-05-12" });
    expect(esvForMonth("2026-05", tax)).toMatchObject({ amount: 1902.34, reason: "minimum" });
    expect(esvForMonth("2026-06", tax)).toMatchObject({ amount: 0, reason: "after-deregistration" });
  });
  it("military service also exempts the single tax and the levy (ПКУ розд. XX підр. 10 п. 25)", () => {
    const tax = taxSettings({
      esvMode: "minimum",
      esvExemptPeriods: [
        { from: "2025-03", to: "2025-05", note: "Mobilised", militaryService: true },
        { from: "2025-11", to: null, note: "Disability" }, // ЄСВ only
      ],
    });
    expect(inMilitaryService("2025-02", tax)).toBe(false);
    expect(inMilitaryService("2025-03", tax)).toBe(true);
    expect(inMilitaryService("2025-05", tax)).toBe(true);
    expect(inMilitaryService("2025-11", tax)).toBe(false);
    const incomes = [fl("2025-02-10", 100_000), fl("2025-04-10", 100_000), fl("2025-07-10", 100_000), fl("2025-11-10", 100_000)];

    // Selected months: no single tax / levy (and no ЄСВ) for April; normal taxes for February and July.
    const calc = calculateTaxes({ incomes, months: ["2025-02", "2025-04", "2025-07"], settings: tax });
    expect(calc.rows.map((r) => [r.month, r.singleTax, r.levy, r.esv, r.militaryService])).toEqual([
      ["2025-02", 5000, 1000, 1760, false],
      ["2025-04", 0, 0, 0, true],
      ["2025-07", 5000, 1000, 1760, false],
    ]);
    expect(calc.totals).toMatchObject({ incomeUah: 300_000, singleTax: 10_000, levy: 2000 });
    expect(calc.warnings.find((w) => w.code === "military-service")?.message).toContain("Apr 2025");

    // Declaration: the service months accrue nothing, the income still counts towards the limit.
    const d = quarterlyDeclaration(2025, { incomes, settings: tax });
    expect(d.quarters.map((q) => [q.payableSingleTax, q.payableLevy])).toEqual([
      [5000, 1000],
      [0, 0],
      [5000, 1000],
      [5000, 1000], // a non-military exempt period keeps the single tax
    ]);
    expect(d.quarters.map((q) => q.militaryServiceMonths)).toEqual([["2025-03"], ["2025-04", "2025-05"], [], []]);
    expect(d.quarters[1].incomeUah).toBe(100_000);
    expect(d.limit.incomeUah).toBe(400_000);
    const st = declarationPaymentStatus(d, {}, "2026-10-15");
    expect(st[1].items.single_tax).toMatchObject({ state: "nothing-due", overdue: false });
    expect(st[1].items.military_levy).toMatchObject({ state: "nothing-due", overdue: false });
  });
  it("settings without the new fields behave as before", () => {
    const legacy = { ...taxSettings({ esvMode: "minimum" }) } as Record<string, unknown>;
    delete legacy.esvExemptPeriods;
    delete legacy.esv2024OptOut;
    delete legacy.fopDeregisteredOn;
    expect(esvForMonth("2024-03", legacy as never)).toMatchObject({ amount: 1562, reason: "minimum" });
  });
});
