import { describe, expect, it } from "vitest";
import { feeUah, receivedUah } from "@/lib/analytics";
import { income } from "@/test/factories";
import type { Income } from "@/lib/types";
import {
  counterpartyHeader,
  describeIncome,
  INCOME_MAX_LIMIT,
  INCOME_PAGE_SIZE,
  incomeHiddenReason,
  incomeHref,
  incomeTitle,
  parseIncomeKindFilter,
  parseIncomeLimit,
  pluralIncomes,
  summarizeIncomeRows,
} from "./income-view";

const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const row = (i: Income) => ({ ...i, receivedUah: receivedUah(i), feeUah: feeUah(i) });

describe("parseIncomeKindFilter", () => {
  it("accepts the two kinds and falls back to all", () => {
    expect(parseIncomeKindFilter("salary")).toBe("salary");
    expect(parseIncomeKindFilter("freelance")).toBe("freelance");
    expect(parseIncomeKindFilter("all")).toBe("all");
    expect(parseIncomeKindFilter("bogus")).toBe("all");
    expect(parseIncomeKindFilter(null)).toBe("all");
    expect(parseIncomeKindFilter(undefined)).toBe("all");
  });
});

describe("incomeHref", () => {
  it("sets and removes kind while preserving the period params", () => {
    expect(incomeHref("period=custom&from=2026-01-01&to=2026-03-31", { kind: "freelance" })).toBe(
      "/income?period=custom&from=2026-01-01&to=2026-03-31&kind=freelance",
    );
    expect(incomeHref("period=last-month&kind=salary", { kind: "all" })).toBe("/income?period=last-month");
    expect(incomeHref("kind=salary", { kind: "all" })).toBe("/income");
  });

  it("switches the period and drops a custom range", () => {
    expect(incomeHref({ period: "custom", from: "2026-01-01", to: "2026-02-01", kind: "salary" }, { period: "all" })).toBe(
      "/income?period=all&kind=salary",
    );
    expect(incomeHref({ period: ["this-month", "x"], kind: undefined }, { period: null })).toBe("/income");
  });

  it("accepts URLSearchParams and a custom pathname", () => {
    expect(incomeHref(new URLSearchParams("period=all"), { kind: "salary" }, "/x")).toBe("/x?period=all&kind=salary");
  });
});

describe("summarizeIncomeRows", () => {
  it("is empty-safe", () => {
    expect(summarizeIncomeRows([])).toEqual({
      count: 0,
      totalUah: 0,
      feesUah: 0,
      receivedUah: 0,
      byCurrency: [],
      hasFees: false,
      hasForeign: false,
    });
  });

  it("totals before and after exchange with exact money math", () => {
    const rows = [
      row(income({ kind: "salary", currency: "UAH", amount: 41230.5 })),
      row(income({ currency: "USD", amount: 1234.56, rate: 44.9801, fee: 10.1 })), // 55 530,63 ₴
      row(income({ currency: "USD", amount: 0.1, rate: 41.2345 })), // 4,12 ₴
      row(income({ currency: "EUR", amount: 950, rate: 48.1234 })), // 45 717,23 ₴
    ];
    const s = summarizeIncomeRows(rows);
    expect(s.count).toBe(4);
    expect(s.byCurrency).toEqual([
      { currency: "UAH", amount: 41230.5, fee: 0, count: 1 },
      { currency: "USD", amount: 1234.66, fee: 10.1, count: 2 },
      { currency: "EUR", amount: 950, fee: 0, count: 1 },
    ]);
    expect(s.totalUah).toBe(142482.48);
    // fee 10,10 $: received 1224,46 × 44,9801 = 55 076,33 → fee in UAH = 55 530,63 − 55 076,33
    expect(s.feesUah).toBe(454.3);
    expect(s.receivedUah).toBe(142028.18);
    expect(s.hasFees).toBe(true);
    expect(s.hasForeign).toBe(true);
  });

  it("reports salary-only views as UAH without fees", () => {
    const s = summarizeIncomeRows([row(income({ kind: "salary", amount: 100 })), row(income({ kind: "salary", amount: 0.2 }))]);
    expect(s.totalUah).toBe(100.2);
    expect(s.hasFees).toBe(false);
    expect(s.hasForeign).toBe(false);
    expect(s.byCurrency).toEqual([{ currency: "UAH", amount: 100.2, fee: 0, count: 2 }]);
  });
});

describe("labels", () => {
  it("names the counterparty column per tab", () => {
    expect(counterpartyHeader("salary")).toBe("Employer");
    expect(counterpartyHeader("freelance")).toBe("Client");
    expect(counterpartyHeader("all")).toBe("Source");
  });

  it("titles a row by counterparty or kind", () => {
    expect(incomeTitle({ kind: "freelance", counterparty: "  Acme  " })).toBe("Acme");
    expect(incomeTitle({ kind: "freelance", counterparty: "   " })).toBe("Freelance");
    expect(incomeTitle({ kind: "salary" })).toBe("Salary");
  });

  it("describes an income for confirmations", () => {
    expect(nbsp(describeIncome({ kind: "freelance", amount: 1000, currency: "USD", date: "2026-10-15", counterparty: "Acme" }))).toBe(
      "freelance income of 1 000,00 $ on 15 Oct 2026 (Acme)",
    );
    expect(nbsp(describeIncome({ kind: "salary", amount: 41230.5, currency: "UAH", date: "2026-10-01" }))).toBe(
      "salary of 41 230,50 ₴ on 1 Oct 2026",
    );
  });

  it("pluralizes", () => {
    expect(pluralIncomes(1)).toBe("1 income");
    expect(pluralIncomes(0)).toBe("0 incomes");
    expect(pluralIncomes(7)).toBe("7 incomes");
  });
});

describe("REACT-8 / JOURNEY-2: income list paging and the hidden-record notice", () => {
  it("parses ?limit= and resets it when the kind or the period changes", () => {
    expect(parseIncomeLimit(undefined)).toBe(INCOME_PAGE_SIZE);
    expect(parseIncomeLimit("120")).toBe(120);
    expect(parseIncomeLimit("5")).toBe(INCOME_PAGE_SIZE);
    expect(parseIncomeLimit("999999")).toBe(INCOME_MAX_LIMIT);
    expect(incomeHref("period=all", { limit: 100 })).toBe("/income?period=all&limit=100");
    expect(incomeHref("period=all&limit=100", { kind: "salary" })).toBe("/income?period=all&kind=salary");
    expect(incomeHref("period=all&limit=100", { period: "this-year" })).toBe("/income?period=this-year");
  });
  it("explains why a saved income is not listed", () => {
    const view = { range: { from: "2026-10-01", to: "2026-10-15" }, kind: "salary" as const };
    expect(incomeHiddenReason({ date: "2026-09-30", kind: "salary" }, view)).toBe("It's dated 30 Sep 2026, outside the selected period.");
    expect(incomeHiddenReason({ date: "2026-10-10", kind: "freelance" }, view)).toMatch(/Freelance or All tab/);
    expect(incomeHiddenReason({ date: "2026-10-10", kind: "salary" }, view)).toBeNull();
  });
});
