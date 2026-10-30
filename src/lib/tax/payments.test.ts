import { describe, expect, it } from "vitest";
import { income, taxSettings } from "@/test/factories";
import type { Income } from "../types";
import { upcomingDeadlines } from "./deadlines";
import { declarationPaymentStatus, quarterlyDeclaration } from "./engine";
import {
  defaultPaymentPeriod,
  esvApplies,
  esvOptionalAvailable,
  optionalEsvByQuarter,
  overdueItems,
  overdueTotal,
  paymentQuarterOptionsForYears,
  pickNextDeadline,
  relevantDeadlines,
  withMinimumEsv,
  yearHasEsv,
} from "./payments";
import { settings as settingsOf } from "@/test/factories";

const fl = (date: string, amountUah: number, over: Partial<Income> = {}) =>
  income({ kind: "freelance", date, amount: amountUah, currency: "UAH", rate: 1, ...over });

const employed = taxSettings({ esvMode: "employed" });
const incomes = [fl("2026-11-10", 200_000), fl("2027-01-10", 50_000)];
const decl = (year: number) => quarterlyDeclaration(year, { incomes: incomes.filter((i) => i.date.startsWith(`${year}-`)), settings: employed });

describe("TAX-1: Record tax payment across years", () => {
  it("in January the previous year's Q4 is offered and preselected (not the new year's Q1)", () => {
    const today = "2027-01-25";
    const declarations = [decl(2027), decl(2026)];
    const statuses = declarations.flatMap((d) => declarationPaymentStatus(d, {}, today));
    const options = paymentQuarterOptionsForYears(declarations, statuses, today);
    expect(options.map((o) => o.period)).toEqual([
      "2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3", "2027-Q4",
    ]);
    expect(options.find((o) => o.period === "2026-Q4")?.label).toBe("Q4 2026 · Annual declaration");
    expect(defaultPaymentPeriod(options)).toBe("2026-Q4");
    expect(options.find((o) => o.period === "2026-Q4")?.items.single_tax.outstanding).toBe(10_000);
  });
  it("the same year twice is offered once", () => {
    const d = decl(2026);
    const statuses = declarationPaymentStatus(d, {}, "2026-10-15");
    expect(paymentQuarterOptionsForYears([d, d], statuses, "2026-10-15")).toHaveLength(4);
  });
});

describe("TAX-2: overdue items across years", () => {
  it("lists last year's unpaid Q4 once the deadline passed, oldest first, with the total", () => {
    const today = "2027-03-01";
    const statuses = [...declarationPaymentStatus(decl(2027), {}, today), ...declarationPaymentStatus(decl(2026), {}, today)];
    const items = overdueItems(statuses);
    expect(items).toEqual([
      { period: "2026-Q4", kind: "single_tax", outstanding: 10_000, deadline: "2027-02-19" },
      { period: "2026-Q4", kind: "military_levy", outstanding: 2_000, deadline: "2027-02-19" },
    ]);
    expect(overdueTotal(items)).toBe(12_000);
  });
});

describe("REACT-2: next actionable deadline", () => {
  it("skips a payment deadline with nothing due (employer-covered ЄСВ) and headlines the filing", () => {
    const today = "2026-10-15";
    const d = quarterlyDeclaration(2026, { incomes: [fl("2026-08-10", 100_000)], settings: employed });
    const statuses = declarationPaymentStatus(d, {}, today);
    const deadlines = upcomingDeadlines(today, { count: 6 });
    expect(deadlines[0]).toMatchObject({ kind: "esv", period: "2026-Q3" });
    expect(pickNextDeadline(deadlines, statuses)).toMatchObject({ kind: "filing", period: "2026-Q3", date: "2026-11-09" });
  });
});

describe("own ЄСВ relevance (employed FOP: the employer pays ЄСВ)", () => {
  const today = "2026-10-15";
  const minimum = taxSettings({ esvMode: "minimum" });
  const statusesFor = (settings: typeof employed, paid: Parameters<typeof declarationPaymentStatus>[1] = {}) =>
    declarationPaymentStatus(quarterlyDeclaration(2026, { incomes: [fl("2026-05-10", 100_000)], settings }), paid, today);

  it("employed: no quarter has own ЄСВ, so no Додаток 1 and no “Pay ЄСВ” deadlines", () => {
    const st = statusesFor(employed);
    expect(st.every((q) => !esvApplies(q))).toBe(true);
    expect(yearHasEsv(st, 2026)).toBe(false);
    const upcoming = upcomingDeadlines(today, { count: 6 });
    expect(upcoming.some((d) => d.kind === "esv")).toBe(true);
    const shown = relevantDeadlines(upcoming, st);
    expect(shown.some((d) => d.kind === "esv")).toBe(false);
    expect(shown.filter((d) => d.kind !== "esv")).toEqual(upcoming.filter((d) => d.kind !== "esv"));
  });

  it("minimum mode: ЄСВ is due every quarter and its deadlines stay", () => {
    const st = statusesFor(minimum);
    expect(st.every((q) => esvApplies(q))).toBe(true);
    expect(yearHasEsv(st, 2026)).toBe(true);
    const upcoming = upcomingDeadlines(today, { count: 6 });
    expect(relevantDeadlines(upcoming, st)).toEqual(upcoming);
  });

  it("an ЄСВ payment recorded anyway keeps that quarter visible; unknown years stay visible", () => {
    const st = statusesFor(employed, { "2026-Q2": { single_tax: 0, military_levy: 0, esv: 500 } });
    expect(esvApplies(st.find((q) => q.period === "2026-Q2"))).toBe(true);
    expect(yearHasEsv(st, 2026)).toBe(true);
    expect(esvApplies(undefined)).toBe(true);
    expect(yearHasEsv(st, 2031)).toBe(true);
  });
});

describe("optional ЄСВ preview (“Include ЄСВ”)", () => {
  it("is offered only when the saved mode owes no ЄСВ", () => {
    expect(esvOptionalAvailable({ esvMode: "employed" })).toBe(true);
    expect(esvOptionalAvailable({ esvMode: "exempt" })).toBe(true);
    expect(esvOptionalAvailable({ esvMode: "minimum" })).toBe(false);
    expect(esvOptionalAvailable({ esvMode: "custom" })).toBe(false);
  });

  it("previews the minimum ЄСВ per quarter without touching the saved settings", () => {
    const saved = settingsOf({}, { esvMode: "employed" });
    const preview = withMinimumEsv(saved);
    expect(preview.tax.esvMode).toBe("minimum");
    expect(saved.tax.esvMode).toBe("employed");
    // 2026: 3 × 1 902,34 per quarter; 2024 Q1 at the old minimum wage (3 × 1 562), Q2 at the new (3 × 1 760).
    expect(optionalEsvByQuarter([2026], saved)).toEqual({ "2026-Q1": 5707.02, "2026-Q2": 5707.02, "2026-Q3": 5707.02, "2026-Q4": 5707.02 });
    expect(optionalEsvByQuarter([2024], saved)).toMatchObject({ "2024-Q1": 4686, "2024-Q2": 5280 });
  });

  it("respects the ФОП registration date (no ЄСВ before it)", () => {
    const saved = settingsOf({}, { esvMode: "employed", fopRegisteredOn: "2026-08-20" });
    expect(optionalEsvByQuarter([2026], saved)).toEqual({ "2026-Q3": 3804.68, "2026-Q4": 5707.02 });
  });
});
