import { describe, expect, it } from "vitest";
import { accountUsage, balanceSheet, computeBalances, type FxRates, type LedgerData } from "@/lib/ledger";
import type { AccountsPageData } from "@/server/queries";
import { account, adjustment, income, transfer } from "@/test/factories";
import {
  buildGroupSections,
  deleteBlock,
  dialogOptions,
  formatQuote,
  recordCount,
  shortDate,
  transferQuote,
  usageSummary,
} from "./accounts-view";

const nbsp = (s: string) => s.replace(/[  ]/g, " ");

function pageData(ledger: LedgerData, fx: FxRates, defaultId: string): Pick<AccountsPageData, "today" | "accounts" | "balances"> {
  const balances = computeBalances(ledger);
  return {
    today: "2026-10-15",
    balances: balanceSheet(ledger, fx),
    accounts: ledger.accounts.map((a) => ({
      account: a,
      usage: accountUsage(a.id, ledger),
      balance: balances[a.id] ?? 0,
      isDefault: a.id === defaultId,
    })),
  };
}

const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH", openingBalance: 1000 });
const fopUsd = account({ id: "fop-usd", name: "FOP USD", group: "freelancer", currency: "USD" });
const oldCard = account({ id: "old", name: "Old card", group: "active", currency: "UAH", archived: true, openingBalance: 50 });
const emptyArchived = account({ id: "gone", name: "Closed", group: "other", currency: "EUR", archived: true });
const ibkr = account({ id: "ibkr", name: "IBKR", group: "ibkr", currency: "USD" });

const ledger: LedgerData = {
  accounts: [main, oldCard, fopUsd, ibkr, emptyArchived],
  incomes: [income({ accountId: "fop-usd", currency: "USD", amount: 1000, rate: 41.5 })],
  expenses: [],
  transfers: [transfer({ fromAccountId: "fop-usd", toAccountId: "main", fromAmount: 400, toAmount: 16_600 })],
  adjustments: [adjustment({ accountId: "ibkr", delta: 250.5 })],
};
const fx: FxRates = { USD: { rate: 41.25, date: "2026-10-15", stale: false }, EUR: null };

describe("buildGroupSections", () => {
  it("always returns the five groups in order", () => {
    const sections = buildGroupSections(pageData(ledger, fx, "main"), false);
    expect(sections.map((s) => s.group)).toEqual(["active", "freelancer", "ibkr", "deposits", "other"]);
    expect(sections.map((s) => s.frozen)).toEqual([false, true, true, true, true]);
    expect(sections[3].rows).toEqual([]);
  });

  it("hides archived accounts by default but keeps counting the ones with money", () => {
    const [active, freelancer, ibkrGroup, , other] = buildGroupSections(pageData(ledger, fx, "main"), false);
    expect(active.rows.map((r) => r.account.id)).toEqual(["main"]);
    expect(active.archivedCount).toBe(1);
    expect(active.hiddenCountedCount).toBe(1);
    // 1000 + 16 600 (transfer in) + 50 (archived old card)
    expect(active.totalUah).toBe(17_650);
    expect(freelancer.rows[0].balance).toBe(600);
    expect(freelancer.rows[0].balanceUah).toBe(24_750);
    expect(freelancer.rows[0].rate).toBe(41.25);
    expect(ibkrGroup.rows[0].balanceUah).toBe(10_333.13); // 250.50 × 41.25 = 10 333.125 → HALF-UP
    expect(other.rows).toEqual([]);
    expect(other.archivedCount).toBe(1);
    expect(other.hiddenCountedCount).toBe(0); // zero balance → not counted
  });

  it("shows archived accounts after the open ones when asked", () => {
    const [active, , , , other] = buildGroupSections(pageData(ledger, fx, "main"), true);
    expect(active.rows.map((r) => r.account.id)).toEqual(["main", "old"]);
    expect(active.hiddenCountedCount).toBe(0);
    expect(other.rows.map((r) => r.account.id)).toEqual(["gone"]);
    expect(other.rows[0].included).toBe(false);
  });

  it("marks groups with an unknown rate as incomplete", () => {
    const [, freelancer] = buildGroupSections(pageData(ledger, {}, "main"), false);
    expect(freelancer.incomplete).toBe(true);
    expect(freelancer.rows[0].balanceUah).toBeNull();
    expect(freelancer.totalUah).toBe(0);
  });
});

describe("dialogOptions", () => {
  it("keeps only open accounts but every balance", () => {
    const o = dialogOptions(pageData(ledger, fx, "main"));
    expect(o.today).toBe("2026-10-15");
    expect(o.accounts.map((a) => a.id)).toEqual(["main", "fop-usd", "ibkr"]);
    expect(o.balances).toEqual({ main: 17_600, old: 50, "fop-usd": 600, ibkr: 250.5, gone: 0 });
  });
});

describe("usage helpers", () => {
  it("summarises usage with plurals", () => {
    expect(usageSummary({ incomes: 0, expenses: 0, transfers: 0, adjustments: 0, investments: 0, debts: 0, total: 0 })).toBe("No records yet");
    expect(usageSummary({ incomes: 3, expenses: 1, transfers: 0, adjustments: 2, investments: 0, debts: 0, total: 6 })).toBe(
      "3 incomes · 1 spending · 2 balance updates",
    );
    expect(usageSummary({ incomes: 0, expenses: 0, transfers: 1, adjustments: 0, investments: 0, debts: 0, total: 1 })).toBe("1 transfer");
    expect(recordCount(1)).toBe("1 record");
    expect(recordCount(12)).toBe("12 records");
  });

  it("blocks deleting the main account and referenced accounts", () => {
    const none = { incomes: 0, expenses: 0, transfers: 0, adjustments: 0, investments: 0, debts: 0, total: 0 };
    const used = { ...none, transfers: 2, total: 2 };
    expect(deleteBlock({ isDefault: true, usage: none })).toEqual({ reason: "default" });
    expect(deleteBlock({ isDefault: false, usage: used })).toEqual({ reason: "used", usage: used });
    expect(deleteBlock({ isDefault: false, usage: none })).toBeNull();
  });
});

describe("transferQuote", () => {
  it("returns null for same-currency transfers", () => {
    expect(transferQuote("UAH", "UAH", 100, 100)).toBeNull();
    expect(transferQuote("USD", "USD", 100, 100)).toBeNull();
  });

  it("orients a sale as UAH per foreign unit", () => {
    const q = transferQuote("USD", "UAH", 1000, 41_200);
    expect(q).toEqual({ base: "USD", quote: "UAH", rate: 41.2, kind: "sale" });
    expect(nbsp(formatQuote(q!))).toBe("1 $ = 41,2000 ₴");
  });

  it("orients a purchase as UAH per foreign unit too", () => {
    const q = transferQuote("UAH", "EUR", 48_123.45, 1000);
    expect(q).toEqual({ base: "EUR", quote: "UAH", rate: 48.1235, kind: "purchase" });
    expect(nbsp(formatQuote(q!))).toBe("1 € = 48,1235 ₴");
  });

  it("orients foreign ↔ foreign as to-currency per from-currency unit", () => {
    const q = transferQuote("EUR", "USD", 100, 108.37);
    expect(q).toEqual({ base: "EUR", quote: "USD", rate: 1.0837, kind: "exchange" });
    expect(nbsp(formatQuote(q!))).toBe("1 € = 1,0837 $");
  });

  it("ignores non-positive amounts", () => {
    expect(transferQuote("USD", "UAH", 0, 100)).toBeNull();
    expect(transferQuote("USD", "UAH", 100, 0)).toBeNull();
  });
});

describe("shortDate", () => {
  it("drops the year only for the current year", () => {
    expect(shortDate("2026-10-10", "2026-10-15")).toBe("10 Oct");
    expect(shortDate("2025-12-31", "2026-10-15")).toBe("31 Dec 2025");
  });
});
