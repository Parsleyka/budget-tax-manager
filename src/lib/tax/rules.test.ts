import { describe, expect, it } from "vitest";
import { taxSettings } from "@/test/factories";
import { quarterlyDeclaration } from "./engine";
import {
  ESV_RATE_BP,
  INCOME_LIMIT_MULTIPLIER,
  incomeLimit,
  isInLevyWindow,
  isRulesAssumed,
  maxBaseMultiplier,
  maxEsvBase,
  maximumEsv,
  militaryLevyRateBp,
  minimumEsv,
  minimumWage,
  OVER_LIMIT_RATE_BP,
  rulesTable,
  SINGLE_TAX_RATE_BP,
  SINGLE_TAX_RATE_VAT_BP,
  singleTaxRateBp,
} from "./rules";

/** Every amount in research/tax-rules.md §1. */
describe("tax-rules.md §1 parameter table", () => {
  it("rates", () => {
    expect(SINGLE_TAX_RATE_BP).toBe(500); // 5%
    expect(SINGLE_TAX_RATE_VAT_BP).toBe(300); // 3%
    expect(OVER_LIMIT_RATE_BP).toBe(1500); // 15%
    expect(ESV_RATE_BP).toBe(2200); // 22%
    expect(INCOME_LIMIT_MULTIPLIER).toBe(1167);
  });

  it("military levy: 0% in 2024, 1% from 2025-01-01, open-ended", () => {
    const tax = taxSettings();
    expect(militaryLevyRateBp("2024-01-01", tax)).toBe(0);
    expect(militaryLevyRateBp("2024-12-31", tax)).toBe(0);
    expect(militaryLevyRateBp("2025-01-01", tax)).toBe(100);
    expect(militaryLevyRateBp("2026-10-15", tax)).toBe(100);
    expect(militaryLevyRateBp("2030-01-01", tax)).toBe(100);
    expect(militaryLevyRateBp("2027-01-01", taxSettings({ militaryLevyEndDate: "2026-12-31" }))).toBe(0);
    expect(militaryLevyRateBp("2026-12-31", taxSettings({ militaryLevyEndDate: "2026-12-31" }))).toBe(100);
    expect(militaryLevyRateBp("2026-01-01", taxSettings({ militaryLevyEnabled: false }))).toBe(0);
    expect(militaryLevyRateBp("2026-01-01", taxSettings({ militaryLevyRateOverridePct: 1.5 }))).toBe(150);
    expect(isInLevyWindow("2025-01-01", tax)).toBe(true);
  });

  it("minimum wage (МЗП) schedule", () => {
    expect(minimumWage("2024-01")).toBe(7100);
    expect(minimumWage("2024-03")).toBe(7100);
    expect(minimumWage("2024-04")).toBe(8000);
    expect(minimumWage("2024-12")).toBe(8000);
    expect(minimumWage("2025-01")).toBe(8000);
    expect(minimumWage("2025-12")).toBe(8000);
    expect(minimumWage("2026-01")).toBe(8647);
    expect(minimumWage("2026-12")).toBe(8647);
  });

  it("minimum monthly ЄСВ = 22% × МЗП", () => {
    expect(minimumEsv("2024-01")).toBe(1562.0);
    expect(minimumEsv("2024-03")).toBe(1562.0);
    expect(minimumEsv("2024-04")).toBe(1760.0);
    expect(minimumEsv("2024-12")).toBe(1760.0);
    expect(minimumEsv("2025-06")).toBe(1760.0);
    expect(minimumEsv("2026-01")).toBe(1902.34);
    expect(minimumEsv("2026-12")).toBe(1902.34);
  });

  it("minimum ЄСВ per quarter / year (minimum mode)", () => {
    const tax = taxSettings({ esvMode: "minimum" });
    const d2024 = quarterlyDeclaration(2024, { incomes: [], settings: tax });
    expect(d2024.quarters[0].esv).toBe(4686.0); // Q1 2024 = 3 × 1 562.00
    expect(d2024.quarters[1].esv).toBe(5280.0); // Q2 2024 = 3 × 1 760.00
    expect(d2024.quarters[2].esv).toBe(5280.0);
    expect(d2024.quarters[3].esv).toBe(5280.0);
    const d2025 = quarterlyDeclaration(2025, { incomes: [], settings: tax });
    expect(d2025.quarters.map((q) => q.esv)).toEqual([5280, 5280, 5280, 5280]);
    expect(d2025.totals.esv).toBe(21120.0);
    const d2026 = quarterlyDeclaration(2026, { incomes: [], settings: tax });
    expect(d2026.quarters.map((q) => q.esv)).toEqual([5707.02, 5707.02, 5707.02, 5707.02]);
    expect(d2026.totals.esv).toBe(22828.08);
  });

  it("maximum ЄСВ base / maximum monthly ЄСВ", () => {
    expect(maxBaseMultiplier(2024)).toBe(15);
    expect(maxBaseMultiplier(2025)).toBe(20);
    expect(maxBaseMultiplier(2026)).toBe(20);
    expect(maxEsvBase("2024-02")).toBe(106500.0);
    expect(maximumEsv("2024-02")).toBe(23430.0);
    expect(maxEsvBase("2024-04")).toBe(120000.0);
    expect(maximumEsv("2024-04")).toBe(26400.0);
    expect(maxEsvBase("2025-07")).toBe(160000.0);
    expect(maximumEsv("2025-07")).toBe(35200.0);
    expect(maxEsvBase("2026-10")).toBe(172940.0);
    expect(maximumEsv("2026-10")).toBe(38046.8);
  });

  it("annual income limit = 1167 × МЗП on 1 January", () => {
    expect(incomeLimit(2024)).toBe(8285700.0); // 1167 × 7 100 (April МЗП change does not move it)
    expect(incomeLimit(2025)).toBe(9336000.0);
    expect(incomeLimit(2026)).toBe(10091049.0);
  });

  it("years beyond the table reuse the last known values (assumed)", () => {
    expect(isRulesAssumed(2026)).toBe(false);
    expect(isRulesAssumed(2027)).toBe(true);
    expect(isRulesAssumed(2023)).toBe(true);
    expect(minimumWage("2027-01")).toBe(8647); // NOT the draft 9 546
    expect(minimumEsv("2027-05")).toBe(1902.34);
    expect(incomeLimit(2027)).toBe(10091049.0);
    expect(maxBaseMultiplier(2027)).toBe(20);
    expect(maxBaseMultiplier(2023)).toBe(15);
    expect(minimumWage("2023-06")).toBe(7100);
  });

  it("single tax rate selection", () => {
    expect(singleTaxRateBp(taxSettings())).toBe(500);
    expect(singleTaxRateBp(taxSettings({ vatPayer: true }))).toBe(300);
    expect(singleTaxRateBp(taxSettings({ singleTaxRateOverridePct: 10 }))).toBe(1000);
    expect(singleTaxRateBp(taxSettings({ vatPayer: true, singleTaxRateOverridePct: 4.5 }))).toBe(450);
  });

  it("rulesTable for display", () => {
    const t = rulesTable();
    expect(t.limits).toEqual([
      { year: 2024, minimumWageJan1: 7100, limit: 8285700 },
      { year: 2025, minimumWageJan1: 8000, limit: 9336000 },
      { year: 2026, minimumWageJan1: 8647, limit: 10091049 },
    ]);
    expect(t.minimumWage.find((r) => r.from === "2026-01")).toMatchObject({ minimumEsv: 1902.34, maxBase: 172940, maximumEsv: 38046.8 });
    expect(t.rates).toMatchObject({ singleTaxPct: 5, singleTaxVatPct: 3, overLimitPct: 15, esvPct: 22, militaryLevyPct: 1 });
  });
});
