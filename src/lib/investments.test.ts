import { describe, expect, it } from "vitest";
import { account, adjustment, transfer } from "@/test/factories";
import { investmentSummary, investmentTotals, isInvestmentAccount, TRACKED_GROUP_COPY, type InvestmentData } from "./investments";
import { accountBalance, balanceSheet, type FxRates } from "./ledger";
import type { InvestmentFlow, Valuation } from "./types";

const TS = "2026-01-01T00:00:00.000Z";
const TODAY = "2026-10-23";
const ibkr = account({ id: "ibkr", name: "IBKR", group: "ibkr", currency: "USD", openingBalance: 0 });
const fopUsd = account({ id: "fop", name: "FOP USD", group: "freelancer", currency: "USD", openingBalance: 3000 });
const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH", openingBalance: 0 });
const fx: FxRates = { USD: { rate: 41.5, date: TODAY, stale: false } };

let n = 0;
const flow = (date: string, amount: number, kind: InvestmentFlow["kind"] = "deposit"): InvestmentFlow => ({
  id: `f${++n}`, accountId: "ibkr", date, kind, amount, createdAt: TS, updatedAt: TS,
});
const valuation = (date: string, value: number, createdAt = TS): Valuation => ({ id: `v${++n}`, accountId: "ibkr", date, value, createdAt });

function data(over: Partial<InvestmentData> = {}): InvestmentData {
  return { accounts: [ibkr, fopUsd, main], incomes: [], expenses: [], transfers: [], adjustments: [], investmentFlows: [], valuations: [], ...over };
}

describe("valuation-aware balance", () => {
  const base = data({
    investmentFlows: [flow("2024-03-01", 5000), flow("2025-01-10", 10000)],
    valuations: [valuation("2026-10-01", 20000)],
    transfers: [transfer({ id: "t1", date: "2026-10-10", fromAccountId: "fop", toAccountId: "ibkr", fromAmount: 1000, toAmount: 1000 })],
  });

  it("value = latest value update + movements after it; principal = deposits; gain = the difference", () => {
    const s = investmentSummary(ibkr, base, TODAY);
    expect(s).toMatchObject({ value: 21000, deposited: 16000, withdrawn: 0, netDeposited: 16000, gain: 5000 });
    expect(s.returnPct).toBeCloseTo(5000 / 16000, 10);
    expect(s.lastValuation?.date).toBe("2026-10-01");
    expect(s.valuationAgeDays).toBe(22);
    // The deposit from FOP USD is a real transfer: FOP USD went down.
    expect(accountBalance("fop", base)).toBe(2000);
    expect(s.movements.map((m) => [m.source, m.kind, m.amount])).toEqual([
      ["transfer", "deposit", 1000],
      ["flow", "deposit", 10000],
      ["flow", "deposit", 5000],
    ]);
  });

  it("is order-independent: older deposits added later change the gain, never the value", () => {
    const later = { ...base, investmentFlows: [...(base.investmentFlows ?? []), flow("2023-06-01", 2000)] };
    const s = investmentSummary(ibkr, later, TODAY);
    expect(s.value).toBe(21000);
    expect(s.netDeposited).toBe(18000);
    expect(s.gain).toBe(3000);
  });

  it("same-day movements: included when entered before the value update, on top when entered after it", () => {
    const sameDay = { ...base, investmentFlows: [...(base.investmentFlows ?? []), flow("2026-10-01", 700)] };
    expect(investmentSummary(ibkr, sameDay, TODAY).value).toBe(21000);
    // "Updated the value, then deposited" on the same day → the deposit counts on top.
    const after = { ...flow("2026-10-01", 700), createdAt: "2026-10-01T18:00:00.000Z" };
    expect(investmentSummary(ibkr, { ...base, investmentFlows: [...(base.investmentFlows ?? []), after] }, TODAY).value).toBe(21700);
    // …a day later it counts on top.
    const nextDay = { ...base, investmentFlows: [...(base.investmentFlows ?? []), flow("2026-10-02", 700)] };
    expect(investmentSummary(ibkr, nextDay, TODAY).value).toBe(21700);
  });

  it("withdrawals reduce both the value (after the update) and the principal", () => {
    const w = { ...base, investmentFlows: [...(base.investmentFlows ?? []), flow("2026-10-15", 500, "withdrawal")] };
    expect(investmentSummary(ibkr, w, TODAY)).toMatchObject({ value: 20500, withdrawn: 500, netDeposited: 15500, gain: 5000 });
  });

  it("without any value update the value is opening + movements + balance adjustments", () => {
    const d = data({ investmentFlows: [flow("2026-02-01", 300)], adjustments: [adjustment({ accountId: "ibkr", date: "2026-03-01", delta: 45 })] });
    expect(investmentSummary(ibkr, d, TODAY)).toMatchObject({ value: 345, netDeposited: 300, gain: 45, lastValuation: null, valuationAgeDays: null });
  });

  it("the latest of several value updates wins; same-day ties go to the one entered last", () => {
    const d = { ...base, valuations: [valuation("2026-10-01", 20000), valuation("2026-10-20", 21500), valuation("2026-10-20", 21600, "2026-10-21T00:00:00.000Z")] };
    expect(investmentSummary(ibkr, d, TODAY).value).toBe(21600);
  });
});

describe("history, chart and totals", () => {
  const d = data({
    investmentFlows: [flow("2026-01-15", 10000), flow("2026-05-10", 2000)],
    valuations: [valuation("2026-03-31", 10400), valuation("2026-06-30", 12900)],
  });

  it("each value update shows how much it moved the account", () => {
    const s = investmentSummary(ibkr, d, TODAY);
    // Newest first: 30 Jun = 12 900 vs 10 400 + 2 000 deposited since → +500; 31 Mar is the first.
    expect(s.valuations.map((v) => [v.date, v.change])).toEqual([
      ["2026-06-30", 500],
      ["2026-03-31", null],
    ]);
  });

  it("chart series: value updates, deposits after the first update (principal steps on its day) and today", () => {
    expect(investmentSummary(ibkr, d, TODAY).series).toEqual([
      { date: "2026-03-31", value: 10400, deposited: 10000 },
      { date: "2026-05-10", value: 12400, deposited: 12000 },
      { date: "2026-06-30", value: 12900, deposited: 12000 },
      { date: TODAY, value: 12900, deposited: 12000 },
    ]);
  });

  it("totals in UAH at today's rate, and the value is part of Frozen (Investments group)", () => {
    const s = investmentSummary(ibkr, d, TODAY);
    expect(investmentTotals([s], fx)).toMatchObject({ valueUah: 535_350, netDepositedUah: 498_000, gainUah: 37_350, incomplete: false });
    const sheet = balanceSheet(d, fx, { asOf: TODAY });
    const inv = sheet.frozenGroups.find((g) => g.group === "ibkr")!;
    expect(inv.label).toBe("Investments");
    expect(inv.totalUah).toBe(535_350);
    expect(investmentTotals([s], {})).toMatchObject({ incomplete: true, missingRates: ["USD"], valueUah: 0 });
  });
});

describe("bank deposits on the Investments page", () => {
  it("investment and deposit accounts are tracked; others are not", () => {
    expect(isInvestmentAccount({ group: "ibkr" })).toBe(true);
    expect(isInvestmentAccount({ group: "deposits" })).toBe(true);
    for (const g of ["active", "freelancer", "other"] as const) expect(isInvestmentAccount({ group: g })).toBe(false);
    expect(TRACKED_GROUP_COPY.deposits).toMatchObject({ title: "Bank deposits", value: "Balance", gain: "Interest earned", update: "Update balance" });
  });

  it("a UAH deposit: top-ups are principal, the balance with interest is the value", () => {
    const dep = account({ id: "dep", name: "Deposits", group: "deposits", currency: "UAH", openingBalance: 0 });
    const d: InvestmentData = {
      accounts: [dep, main],
      incomes: [],
      expenses: [],
      transfers: [transfer({ id: "t", date: "2026-05-01", fromAccountId: "main", toAccountId: "dep", fromAmount: 30000, toAmount: 30000 })],
      adjustments: [],
      investmentFlows: [{ id: "f", accountId: "dep", date: "2026-01-10", kind: "deposit", amount: 50000, createdAt: TS, updatedAt: TS }],
      valuations: [{ id: "v", accountId: "dep", date: "2026-10-01", value: 83500, createdAt: TS }],
    };
    expect(investmentSummary(dep, d, TODAY)).toMatchObject({ value: 83500, netDeposited: 80000, gain: 3500 });
    expect(investmentSummary(dep, d, TODAY).returnPct).toBeCloseTo(3500 / 80000, 10);
    expect(investmentTotals([investmentSummary(dep, d, TODAY)], fx)).toMatchObject({ valueUah: 83500, netDepositedUah: 80000, gainUah: 3500 });
  });
});
