import { describe, expect, it } from "vitest";
import { account, adjustment, expense, income, transfer } from "@/test/factories";
import { accountBalance, accountUsage, balanceSheet, computeBalances, type LedgerData } from "./ledger";

const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH", openingBalance: 1000 });
const fopUsd = account({ id: "fop-usd", name: "FOP USD", group: "freelancer", currency: "USD" });
const fopUah = account({ id: "fop-uah", name: "FOP UAH", group: "freelancer", currency: "UAH" });
const ibkr = account({ id: "ibkr", name: "IBKR", group: "ibkr", currency: "USD", openingBalance: 500 });
const deposit = account({ id: "dep", name: "Deposit", group: "deposits", currency: "UAH", openingBalance: 20000 });
const eurAcc = account({ id: "eur", name: "FOP EUR", group: "freelancer", currency: "EUR" });

function data(over: Partial<LedgerData> = {}): LedgerData {
  return {
    accounts: [main, fopUsd, fopUah, ibkr, deposit, eurAcc],
    incomes: [],
    expenses: [],
    transfers: [],
    adjustments: [],
    ...over,
  };
}

describe("account balances", () => {
  it("opening + incomes (net of fee) − expenses ± transfers + adjustments", () => {
    const d = data({
      incomes: [
        income({ kind: "salary", accountId: "main", amount: 30000.5 }),
        income({ accountId: "fop-usd", currency: "USD", amount: 1000, fee: 12.34, rate: 44.9801 }),
      ],
      expenses: [expense({ accountId: "main", amount: 1234.56 }), expense({ accountId: "main", amount: 0.1 })],
      transfers: [
        // sell 500 USD for 22 450 UAH
        transfer({ fromAccountId: "fop-usd", toAccountId: "main", fromAmount: 500, toAmount: 22450 }),
        transfer({ fromAccountId: "main", toAccountId: "dep", fromAmount: 10000, toAmount: 10000 }),
      ],
      adjustments: [adjustment({ accountId: "ibkr", delta: 123.45 }), adjustment({ accountId: "dep", delta: -0.2 })],
    });
    const b = computeBalances(d);
    expect(b.main).toBe(1000 + 30000.5 - 1234.56 - 0.1 + 22450 - 10000); // 42215.84
    expect(b.main).toBe(42215.84);
    expect(b["fop-usd"]).toBe(487.66); // 1000 − 12.34 − 500
    expect(b.ibkr).toBe(623.45);
    expect(b.dep).toBe(29999.8);
    expect(b["fop-uah"]).toBe(0);
    expect(accountBalance("main", d)).toBe(42215.84);
    expect(accountBalance("nope", d)).toBe(0);
  });

  it("asOf only counts movements up to the date", () => {
    const d = data({
      expenses: [expense({ accountId: "main", amount: 100, date: "2026-01-10" }), expense({ accountId: "main", amount: 50, date: "2026-02-10" })],
    });
    expect(accountBalance("main", d, { asOf: "2026-01-31" })).toBe(900);
    expect(accountBalance("main", d)).toBe(850);
  });

  it("ignores movements for unknown accounts", () => {
    const d = data({ expenses: [expense({ accountId: "ghost", amount: 5 })] });
    expect(computeBalances(d).ghost).toBeUndefined();
  });
});

describe("balance sheet (Active / Frozen / Net worth with FX)", () => {
  it("converts at today's rate and groups", () => {
    const d = data({
      incomes: [income({ accountId: "fop-usd", currency: "USD", amount: 1000, rate: 44.9801 })],
      adjustments: [adjustment({ accountId: "eur", delta: 200 })],
    });
    const sheet = balanceSheet(d, {
      USD: { rate: 44.9801, date: "2026-10-15", stale: false },
      EUR: { rate: 52.1234, date: "2026-10-15", stale: false },
    });
    expect(sheet.activeUah).toBe(1000);
    const freelancer = sheet.frozenGroups.find((g) => g.group === "freelancer");
    // 1000 USD × 44.9801 = 44 980.10 ; 200 EUR × 52.1234 = 10 424.68
    expect(freelancer?.totalUah).toBe(55404.78);
    const ibkrGroup = sheet.frozenGroups.find((g) => g.group === "ibkr");
    expect(ibkrGroup?.totalUah).toBe(22490.05); // 500 × 44.9801
    expect(sheet.frozenGroups.map((g) => g.group)).toEqual(["freelancer", "ibkr", "deposits", "other"]);
    expect(sheet.frozenUah).toBe(55404.78 + 22490.05 + 20000);
    expect(sheet.netWorthUah).toBe(1000 + 97894.83);
    expect(sheet.stale).toBe(false);
    expect(sheet.missingRates).toEqual([]);
    const usdRow = sheet.accounts.find((a) => a.account.id === "fop-usd");
    expect(usdRow).toMatchObject({ balance: 1000, balanceUah: 44980.1, rate: 44.9801, currency: "USD" });
  });

  it("flags stale rates and missing rates", () => {
    const d = data({ incomes: [income({ accountId: "fop-usd", currency: "USD", amount: 10, rate: 40 })] });
    const stale = balanceSheet(d, { USD: { rate: 40, date: "2026-10-10", stale: true }, EUR: null });
    expect(stale.stale).toBe(true);
    // EUR account has zero balance → not "missing"
    expect(stale.missingRates).toEqual([]);
    const missing = balanceSheet(d, { EUR: null });
    expect(missing.missingRates.sort()).toEqual(["USD"]);
    expect(missing.frozenGroups[0].incomplete).toBe(true);
    // IBKR (500 USD) and FOP USD (10 USD) are excluded from totals
    expect(missing.frozenUah).toBe(20000);
  });

  it("archived accounts count only when their balance is non-zero", () => {
    const oldCard = account({ id: "old", group: "active", archived: true, openingBalance: 0 });
    const oldWithMoney = account({ id: "old2", group: "other", archived: true, openingBalance: 300 });
    const sheet = balanceSheet(data({ accounts: [main, oldCard, oldWithMoney] }), {});
    expect(sheet.accounts.find((a) => a.account.id === "old")?.included).toBe(false);
    expect(sheet.accounts.find((a) => a.account.id === "old2")?.included).toBe(true);
    expect(sheet.frozenUah).toBe(300);
    expect(sheet.netWorthUah).toBe(1300);
  });
});

describe("accountUsage", () => {
  it("counts references", () => {
    const d = data({
      incomes: [income({ accountId: "main", kind: "salary" })],
      expenses: [expense({ accountId: "main" }), expense({ accountId: "main" })],
      transfers: [transfer({ fromAccountId: "main", toAccountId: "dep" })],
      adjustments: [adjustment({ accountId: "dep" })],
    });
    expect(accountUsage("main", d)).toEqual({ incomes: 1, expenses: 2, transfers: 1, adjustments: 0, investments: 0, debts: 0, total: 4 });
    expect(accountUsage("dep", d).total).toBe(2);
    expect(accountUsage("ibkr", d).total).toBe(0);
  });
});
