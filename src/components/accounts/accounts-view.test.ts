import { describe, expect, it } from "vitest";
import { accountUsage, balanceSheet, computeBalances, type FxRates, type LedgerData } from "@/lib/ledger";
import type { AccountsPageData } from "@/server/queries";
import { account, adjustment, income, transfer } from "@/test/factories";
import {
  buildGroupSections,
  deleteBlock,
  dialogOptions,
  formatQuote,
  groupCheckState,
  recordCount,
  shortDate,
  summarizeSelection,
  transferQuote,
  usageSummary,
  visibleSections,
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

describe("visibleSections", () => {
  it("drops groups with nothing to show, keeps hidden archived money in its group", () => {
    const groups = (showArchived: boolean) => visibleSections(buildGroupSections(pageData(ledger, fx, "main"), showArchived)).map((s) => s.group);
    expect(groups(false)).toEqual(["active", "freelancer", "ibkr"]);
    expect(groups(true)).toEqual(["active", "freelancer", "ibkr", "other"]);

    // Only an archived account with money: its total still counts, so the group stays (with no rows).
    const hidden: LedgerData = { ...ledger, accounts: [main, account({ id: "safe", name: "Safe", group: "other", currency: "UAH", archived: true, openingBalance: 70 })] };
    const other = visibleSections(buildGroupSections(pageData(hidden, fx, "main"), false)).find((s) => s.group === "other");
    expect(other).toMatchObject({ rows: [], totalUah: 70 });
  });
});

describe("selection", () => {
  const rows = (fxRates: FxRates = fx) => buildGroupSections(pageData(ledger, fxRates, "main"), false).flatMap((s) => s.rows);

  it("sums the selected accounts in UAH (at the NBU rate) and per foreign currency", () => {
    // Main card 1 000 + 16 600; FOP USD 1 000 − 400 = 600 $ = 24 750 ₴; IBKR 250,50 $ = 10 333,13 ₴.
    expect(summarizeSelection(rows(), new Set(["main", "fop-usd", "ibkr"]))).toEqual({
      count: 3,
      totalUah: 52_683.13,
      foreign: [{ currency: "USD", amount: 850.5 }],
      missingRates: 0,
    });
    expect(summarizeSelection(rows(), new Set())).toEqual({ count: 0, totalUah: 0, foreign: [], missingRates: 0 });
  });

  it("selecting a whole group equals the group's total", () => {
    const [freelancer] = buildGroupSections(pageData(ledger, fx, "main"), false).filter((s) => s.group === "freelancer");
    const ids = new Set(freelancer.rows.map((r) => r.account.id));
    expect(summarizeSelection(freelancer.rows, ids).totalUah).toBe(freelancer.totalUah);
  });

  it("ignores ids that are no longer listed (hidden archived, deleted)", () => {
    expect(summarizeSelection(rows(), new Set(["main", "old", "deleted"]))).toMatchObject({ count: 1, totalUah: 17_600 });
  });

  it("leaves accounts without an NBU rate out of the UAH sum and says so", () => {
    expect(summarizeSelection(rows({ USD: null }), new Set(["main", "fop-usd"]))).toEqual({
      count: 2,
      totalUah: 17_600,
      foreign: [{ currency: "USD", amount: 600 }],
      missingRates: 1,
    });
  });

  it("gives a group checkbox its state: none, some or all", () => {
    const list = rows();
    expect(groupCheckState(list, new Set())).toBe(false);
    expect(groupCheckState(list, new Set(["main"]))).toBe("indeterminate");
    expect(groupCheckState(list, new Set(["main", "fop-usd", "ibkr"]))).toBe(true);
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
