import { describe, expect, it } from "vitest";
import { balanceSheet, type FxRates, type LedgerData } from "@/lib/ledger";
import { formatPercent } from "@/lib/money";
import { upcomingDeadlines } from "@/lib/tax/deadlines";
import type { QuarterPaymentStatus } from "@/lib/tax/engine";
import { account, adjustment, income } from "@/test/factories";
import {
  daysLeftText,
  deadlineDue,
  deadlineParts,
  frozenBreakdown,
  hasAnyBalance,
  incomeSplit,
  oldestStaleRateDate,
  relativeDayLabel,
  transactionHref,
} from "./overview-model";

const FX: FxRates = {
  USD: { rate: 41.5, date: "2026-10-15", stale: false },
  EUR: { rate: 48.25, date: "2026-10-14", stale: true },
};

function ledger(over: Partial<LedgerData> = {}): LedgerData {
  return { accounts: [], incomes: [], expenses: [], transfers: [], adjustments: [], ...over };
}

const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH", openingBalance: 5000 });
const fopUah = account({ id: "fop-uah", name: "FOP UAH", group: "freelancer", currency: "UAH", openingBalance: 1000 });
const fopUsd = account({ id: "fop-usd", name: "FOP USD", group: "freelancer", currency: "USD", openingBalance: 100 });
const fopEur = account({ id: "fop-eur", name: "FOP EUR", group: "freelancer", currency: "EUR", openingBalance: 0 });
const ibkr = account({ id: "ibkr", name: "IBKR", group: "ibkr", currency: "USD", openingBalance: 200 });
const deposits = account({ id: "dep", name: "Deposits", group: "deposits", currency: "UAH", openingBalance: 2000 });
const other = account({ id: "other", name: "Other", group: "other", currency: "UAH", openingBalance: 0 });
const oldArchived = account({ id: "old", name: "Old", group: "other", currency: "UAH", archived: true });

describe("frozenBreakdown", () => {
  const sheet = balanceSheet(ledger({ accounts: [main, fopUah, fopUsd, fopEur, ibkr, deposits, other, oldArchived] }), FX);
  const b = frozenBreakdown(sheet);

  it("keeps the 4 groups in fixed order with fixed colours", () => {
    expect(b.groups.map((g) => g.group)).toEqual(["freelancer", "ibkr", "deposits", "other"]);
    expect(b.groups.map((g) => g.color)).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"]);
  });

  it("sums exactly and computes shares of the positive total", () => {
    // freelancer = 1000 + 100 × 41.5 = 5150; ibkr = 200 × 41.5 = 8300; deposits 2000; other 0 → 15450
    expect(b.totalUah).toBe(15450);
    const [fr, ib, dep, oth] = b.groups;
    expect(fr.totalUah).toBe(5150);
    expect(ib.totalUah).toBe(8300);
    expect(fr.share).toBeCloseTo(5150 / 15450, 10);
    expect(dep.share).toBeCloseTo(2000 / 15450, 10);
    expect(oth.share).toBeNull();
    expect(b.segments.map((s) => s.group)).toEqual(["freelancer", "ibkr", "deposits"]);
    expect(b.segments.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
    expect(b.hasNegative).toBe(false);
  });

  it("lists included accounts largest first and hides archived zero-balance ones", () => {
    expect(b.groups[0].accounts.map((a) => a.account.name)).toEqual(["FOP USD", "FOP UAH", "FOP EUR"]);
    expect(b.groups[3].accounts.map((a) => a.account.name)).toEqual(["Other"]);
    expect(b.accountCount).toBe(6);
    const usd = b.groups[0].accounts[0];
    expect(usd.balance).toBe(100);
    expect(usd.balanceUah).toBe(4150);
    expect(usd.share).toBeCloseTo(4150 / 15450, 10);
    expect(b.groups[0].accounts[2].share).toBeNull(); // zero balance
  });

  it("leaves negative groups out of the bar and flags them", () => {
    const neg = balanceSheet(
      ledger({
        accounts: [main, deposits, other],
        adjustments: [adjustment({ accountId: "other", delta: -500 })],
      }),
      FX,
    );
    const nb = frozenBreakdown(neg);
    expect(nb.hasNegative).toBe(true);
    expect(nb.totalUah).toBe(1500);
    expect(nb.segments.map((s) => s.group)).toEqual(["deposits"]);
    expect(nb.segments[0].share).toBe(1);
    expect(nb.groups[3].share).toBeNull();
  });

  it("returns no segments for a fresh install", () => {
    const empty = frozenBreakdown(balanceSheet(ledger({ accounts: [main, fopUah, fopUsd, ibkr].map((a) => ({ ...a, openingBalance: 0 })) }), FX));
    expect(empty.segments).toEqual([]);
    expect(empty.totalUah).toBe(0);
    expect(empty.groups.every((g) => g.share === null)).toBe(true);
  });

  it("keeps accounts without a rate visible (UAH value null) and sorts them last", () => {
    const noRate = frozenBreakdown(balanceSheet(ledger({ accounts: [fopUah, fopUsd] }), { USD: null, EUR: null }));
    expect(noRate.groups[0].incomplete).toBe(true);
    expect(noRate.groups[0].accounts.map((a) => [a.account.name, a.balanceUah])).toEqual([
      ["FOP UAH", 1000],
      ["FOP USD", null],
    ]);
  });
});

describe("LEDGER-4: shown Frozen shares add up", () => {
  /** Tenths of a percent as the Share column shows them ("24,7%" → 247). */
  const tenths = (v: number | null) => (v === null ? 0 : Math.round(Number(formatPercent(v).replace(/[^\d,]/g, "").replace(",", ".")) * 10));
  const uah = (id: string, group: "freelancer" | "ibkr" | "deposits" | "other", openingBalance: number) =>
    account({ id, name: id, group, currency: "UAH", openingBalance });

  it("group shares add up to the 100,0 % of the Total row (was 24,7 + 23,9 + 51,2 + 0,1 = 99,9 %)", () => {
    const sheet = balanceSheet(
      ledger({ accounts: [uah("fr", "freelancer", 2473.78), uah("ib", "ibkr", 2393.43), uah("dep", "deposits", 5121.39), uah("oth", "other", 11.4)] }),
      FX,
    );
    const b = frozenBreakdown(sheet);
    expect(b.groups.reduce((s, g) => s + tenths(g.share), 0)).toBe(999); // each exact share rounded alone
    expect(b.groups.map((g) => tenths(g.displayShare))).toEqual([248, 239, 512, 1]);
    expect(b.segments.reduce((s, x) => s + tenths(x.displayShare), 0)).toBe(1000);
    // exact shares stay exact (bar widths)
    expect(b.totalUah).toBe(10000);
    expect(b.groups[0].share).toBeCloseTo(2473.78 / 10000, 10);
  });

  it("account shares add up to their group's shown share", () => {
    const sheet = balanceSheet(
      ledger({
        accounts: [uah("a1", "freelancer", 1), uah("a2", "freelancer", 1), uah("a3", "freelancer", 1), uah("d", "deposits", 6)],
      }),
      FX,
    );
    const b = frozenBreakdown(sheet);
    const fr = b.groups[0];
    expect(tenths(fr.displayShare)).toBe(333);
    expect(fr.accounts.map((a) => tenths(a.displayShare))).toEqual([111, 111, 111]);
    expect(tenths(b.groups[2].displayShare)).toBe(667);
  });

  it("account shares add up to their group's shown share where rounding each alone would not (0,1 + 0,1 ≠ 0,1)", () => {
    const sheet = balanceSheet(
      ledger({ accounts: [uah("a1", "freelancer", 1), uah("a2", "freelancer", 1), uah("d", "deposits", 1998)] }),
      FX,
    );
    const b = frozenBreakdown(sheet);
    const fr = b.groups[0];
    expect(fr.accounts.reduce((s, a) => s + tenths(a.share), 0)).toBe(2); // each exact 0,05 % shown alone as 0,1 %
    expect(tenths(fr.displayShare)).toBe(1);
    expect(fr.accounts.reduce((s, a) => s + tenths(a.displayShare), 0)).toBe(1);
    expect(tenths(b.groups[2].displayShare)).toBe(999);
  });

  it("a group with a negative account shows no account shares (an account can't look bigger than its group)", () => {
    const sheet = balanceSheet(
      ledger({
        accounts: [uah("plus", "other", 1000), uah("minus", "other", 0), uah("d", "deposits", 1000)],
        adjustments: [adjustment({ accountId: "minus", delta: -900 })],
      }),
      FX,
    );
    const b = frozenBreakdown(sheet);
    const other = b.groups[3];
    expect(other.totalUah).toBe(100);
    expect(b.hasNegative).toBe(true);
    expect(other.accounts.map((a) => [a.account.id, a.share, a.displayShare])).toEqual([
      ["plus", null, null],
      ["minus", null, null],
    ]);
    expect(tenths(other.displayShare) + tenths(b.groups[2].displayShare)).toBe(1000);
  });
});

describe("balance helpers", () => {
  it("hasAnyBalance / oldestStaleRateDate", () => {
    const eurAcc = account({ id: "eur", name: "EUR", group: "freelancer", currency: "EUR", openingBalance: 10 });
    const sheet = balanceSheet(ledger({ accounts: [main, eurAcc, fopUsd] }), FX);
    expect(hasAnyBalance(sheet)).toBe(true);
    expect(oldestStaleRateDate(sheet)).toBe("2026-10-14");
    const zero = balanceSheet(ledger({ accounts: [{ ...main, openingBalance: 0 }] }), FX);
    expect(hasAnyBalance(zero)).toBe(false);
    expect(oldestStaleRateDate(zero)).toBeNull();
  });

  it("counts an income credited net of fee as a balance", () => {
    const sheet = balanceSheet(
      ledger({ accounts: [{ ...fopUah, openingBalance: 0 }], incomes: [income({ accountId: "fop-uah", amount: 100, fee: 5 })] }),
      FX,
    );
    expect(hasAnyBalance(sheet)).toBe(true);
    expect(frozenBreakdown(sheet).totalUah).toBe(95);
  });
});

describe("recent transaction helpers", () => {
  it("links each type to its page (incomes/spendings filtered to the day)", () => {
    expect(transactionHref({ type: "income", date: "2026-10-12", incomeKind: "freelance" })).toBe(
      "/income?period=custom&from=2026-10-12&to=2026-10-12&kind=freelance",
    );
    expect(transactionHref({ type: "income", date: "2026-10-12", incomeKind: "salary" })).toBe(
      "/income?period=custom&from=2026-10-12&to=2026-10-12&kind=salary",
    );
    expect(transactionHref({ type: "expense", date: "2026-10-01" })).toBe("/expenses?period=custom&from=2026-10-01&to=2026-10-01");
    expect(transactionHref({ type: "transfer", date: "2026-10-01" })).toBe("/accounts#transfers");
    expect(transactionHref({ type: "adjustment", date: "2026-10-01" })).toBe("/accounts#balance-updates");
  });

  it("labels days relative to the server's today", () => {
    expect(relativeDayLabel("2026-10-15", "2026-10-15")).toBe("Today");
    expect(relativeDayLabel("2026-10-14", "2026-10-15")).toBe("Yesterday");
    expect(relativeDayLabel("2026-10-16", "2026-10-15")).toBe("Tomorrow");
    expect(relativeDayLabel("2026-10-01", "2026-10-15")).toBe("1 Oct");
    expect(relativeDayLabel("2025-12-31", "2026-01-02")).toBe("31 Dec 2025");
  });
});

describe("this-month helpers", () => {
  it("incomeSplit uses freelance net of fees", () => {
    expect(incomeSplit({ salaryUah: 0, freelanceNetUah: 0 })).toBeNull();
    const s = incomeSplit({ salaryUah: 30000.5, freelanceNetUah: 10000.5 });
    expect(s?.salaryUah).toBe(30000.5);
    expect(s?.freelanceUah).toBe(10000.5);
    expect((s?.salaryShare ?? 0) + (s?.freelanceShare ?? 0)).toBeCloseTo(1, 12);
  });
});

describe("tax deadline helpers", () => {
  it("reads the next deadlines for 15 Oct 2026 (ЄСВ Q3 on Mon 19 Oct)", () => {
    const [first, second, third] = upcomingDeadlines("2026-10-15", { count: 3 });
    expect([first.kind, first.date, first.daysLeft]).toEqual(["esv", "2026-10-19", 4]);
    expect([second.kind, second.date]).toEqual(["filing", "2026-11-09"]);
    expect([third.kind, third.date]).toEqual(["payment", "2026-11-19"]);
    expect(deadlineParts(first)).toEqual({ action: "Pay ЄСВ", period: "Q3 2026" });
    expect(deadlineParts({ kind: "filing", period: "2026-Q4", quarter: 4 })).toEqual({
      action: "File declaration",
      period: "Q4 2026 · annual",
    });
  });

  it("daysLeftText", () => {
    expect(daysLeftText(0)).toBe("today");
    expect(daysLeftText(1)).toBe("tomorrow");
    expect(daysLeftText(4)).toBe("in 4 days");
    expect(daysLeftText(-2)).toBe("2 days ago");
  });

  it("deadlineDue maps payment → single tax + levy, esv → ЄСВ, filing → null", () => {
    const item = (outstanding: number, state: "unpaid" | "paid" | "nothing-due") => ({
      kind: "single_tax" as const,
      due: outstanding,
      paid: 0,
      creditApplied: 0,
      carriedForward: 0,
      outstanding,
      state,
      deadline: "2026-11-19",
      overdue: false,
      daysLeft: 35,
    });
    const statuses: QuarterPaymentStatus[] = [
      {
        period: "2026-Q3",
        quarter: 3,
        items: { single_tax: item(500.25, "unpaid"), military_levy: item(100.05, "unpaid"), esv: item(0, "nothing-due") },
        outstanding: 600.3,
      },
    ];
    expect(deadlineDue({ kind: "payment", period: "2026-Q3" }, statuses)).toEqual({ outstanding: 600.3, settled: false, nothingDue: false });
    expect(deadlineDue({ kind: "esv", period: "2026-Q3" }, statuses)).toEqual({ outstanding: 0, settled: true, nothingDue: true });
    expect(deadlineDue({ kind: "filing", period: "2026-Q3" }, statuses)).toBeNull();
    expect(deadlineDue({ kind: "esv", period: "2026-Q4" }, statuses)).toBeNull();
    expect(deadlineDue({ kind: "esv", period: "2026-Q3" }, undefined)).toBeNull();
  });
});
