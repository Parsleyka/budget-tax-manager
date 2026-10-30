import { describe, expect, it } from "vitest";
import type { CategorySpending } from "@/lib/analytics";
import {
  BREAKDOWN_LIMIT,
  DEFAULT_SORT,
  MAX_LIMIT,
  PAGE_SIZE,
  applyParamPatch,
  breakdownRows,
  dayTotals,
  filterByCategories,
  formatCount,
  groupByDay,
  hiddenReason,
  isDateSort,
  parseCategoryIds,
  parseLimit,
  parseSort,
  pickDayTotals,
  pluralize,
  relativeDayLabel,
  serializeCategoryIds,
  soleCategoryToggle,
  sortExpenseRows,
  type ExpenseLike,
} from "./expense-list-model";

let seq = 0;
function row(p: Partial<ExpenseLike> & Pick<ExpenseLike, "date" | "amountUah">): ExpenseLike {
  seq += 1;
  return {
    id: p.id ?? `e${seq}`,
    createdAt: p.createdAt ?? `2026-10-01T10:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    amount: p.amount ?? p.amountUah,
    currency: p.currency ?? "UAH",
    categoryId: p.categoryId ?? "groceries",
    ...p,
  };
}

function spending(categoryId: string, totalUah: number, share: number): CategorySpending {
  return { categoryId, name: categoryId, color: "blue", archived: false, totalUah, count: 1, share };
}

describe("URL params", () => {
  it("parses sort with a safe default", () => {
    expect(parseSort(undefined)).toBe(DEFAULT_SORT);
    expect(parseSort("amount-desc")).toBe("amount-desc");
    expect(parseSort(["date-asc", "amount-asc"])).toBe("date-asc");
    expect(parseSort("nope")).toBe("date-desc");
    expect(isDateSort("date-asc")).toBe(true);
    expect(isDateSort("amount-asc")).toBe(false);
  });

  it("parses limit and clamps it", () => {
    expect(parseLimit(undefined)).toBe(PAGE_SIZE);
    expect(parseLimit("100")).toBe(100);
    expect(parseLimit("10")).toBe(PAGE_SIZE);
    expect(parseLimit("999999")).toBe(MAX_LIMIT);
    expect(parseLimit("-5")).toBe(PAGE_SIZE);
    expect(parseLimit("12.5")).toBe(PAGE_SIZE);
    expect(parseLimit("abc")).toBe(PAGE_SIZE);
  });

  it("parses comma-separated and repeated category ids, dropping unknown and duplicate ids", () => {
    expect(parseCategoryIds(undefined)).toEqual([]);
    expect(parseCategoryIds("a")).toEqual(["a"]);
    expect(parseCategoryIds("a, b,,a")).toEqual(["a", "b"]);
    expect(parseCategoryIds(["a,b", "c", "b"])).toEqual(["a", "b", "c"]);
    expect(parseCategoryIds("a,zzz,b", ["a", "b"])).toEqual(["a", "b"]);
    expect(serializeCategoryIds([])).toBeNull();
    expect(serializeCategoryIds(["a", "b"])).toBe("a,b");
  });

  it("patches a query string and resets the page size unless asked not to", () => {
    const q = "period=last-month&category=a&limit=150&q=silpo";
    expect(applyParamPatch(q, { category: "a,b" })).toBe("period=last-month&category=a%2Cb&q=silpo");
    expect(applyParamPatch(q, { q: null, category: "" })).toBe("period=last-month");
    expect(applyParamPatch(q, { sort: "amount-desc" }, { keepLimit: true })).toBe(
      "period=last-month&category=a&limit=150&q=silpo&sort=amount-desc",
    );
    expect(applyParamPatch(q, { limit: "200" })).toBe("period=last-month&category=a&limit=200&q=silpo");
    expect(applyParamPatch("", {})).toBe("");
  });
});

describe("rows", () => {
  const a = row({ id: "a", date: "2026-10-14", amountUah: 100, createdAt: "2026-10-14T08:00:00.000Z", categoryId: "food" });
  const b = row({ id: "b", date: "2026-10-15", amountUah: 50.5, createdAt: "2026-10-15T08:00:00.000Z", categoryId: "fun" });
  const c = row({ id: "c", date: "2026-10-15", amountUah: 300, createdAt: "2026-10-15T09:00:00.000Z", categoryId: "food" });
  const d = row({ id: "d", date: "2026-10-13", amountUah: 100, createdAt: "2026-10-13T08:00:00.000Z", categoryId: "taxes" });
  const rows = [a, b, c, d];

  it("filters by any of the selected categories", () => {
    expect(filterByCategories(rows, []).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterByCategories(rows, ["food", "taxes"]).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  it("sorts by date (newest first, ties by createdAt) and by UAH amount", () => {
    expect(sortExpenseRows(rows, "date-desc").map((r) => r.id)).toEqual(["c", "b", "a", "d"]);
    expect(sortExpenseRows(rows, "date-asc").map((r) => r.id)).toEqual(["d", "a", "b", "c"]);
    // a and d tie on 100 → newest first
    expect(sortExpenseRows(rows, "amount-desc").map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
    expect(sortExpenseRows(rows, "amount-asc").map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
    // does not mutate
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("totals per day exactly (no float drift)", () => {
    const t = dayTotals([
      row({ date: "2026-10-01", amountUah: 0.1 }),
      row({ date: "2026-10-01", amountUah: 0.2 }),
      row({ date: "2026-10-02", amountUah: 1 }),
    ]);
    expect(t["2026-10-01"]).toEqual({ totalUah: 0.3, count: 2 });
    expect(t["2026-10-02"]).toEqual({ totalUah: 1, count: 1 });
    expect(pickDayTotals(t, ["2026-10-02", "2026-09-30"])).toEqual({ "2026-10-02": { totalUah: 1, count: 1 } });
  });

  it("groups consecutive days and prefers totals of the full filtered set", () => {
    const sorted = sortExpenseRows(rows, "date-desc");
    const visible = sorted.slice(0, 2); // c, b (15 Oct) — a day fully visible
    const groups = groupByDay(visible, dayTotals(sorted));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ date: "2026-10-15", totalUah: 350.5, count: 2 });
    expect(groups[0].rows.map((r) => r.id)).toEqual(["c", "b"]);

    const cut = groupByDay(sorted.slice(0, 1), dayTotals(sorted)); // only c rendered
    expect(cut[0]).toMatchObject({ date: "2026-10-15", totalUah: 350.5, count: 2 });
    expect(cut[0].rows).toHaveLength(1);

    const own = groupByDay(sorted);
    expect(own.map((g) => [g.date, g.totalUah, g.count])).toEqual([
      ["2026-10-15", 350.5, 2],
      ["2026-10-14", 100, 1],
      ["2026-10-13", 100, 1],
    ]);
  });
});

describe("by-category breakdown", () => {
  it("rounds shares to 100,0 % in total, sizes bars against the biggest and skips zero rows", () => {
    // 1/3 each: rounded alone that is 33,3 % × 3 = 99,9 %; largest remainder makes it 100,0 %.
    const rows = breakdownRows([spending("a", 100, 1 / 3), spending("b", 100, 1 / 3), spending("c", 100, 1 / 3), spending("z", 0, 0)]);
    expect(rows.map((r) => r.categoryId)).toEqual(["a", "b", "c"]);
    expect(rows.reduce((sum, r) => sum + Math.round(r.share * 1000), 0)).toBe(1000);
    expect(rows.every((r) => r.width === 1)).toBe(true);

    const uneven = breakdownRows([spending("food", 300.5, 0.75), spending("fun", 100.17, 0.25)]);
    expect(uneven[0].width).toBe(1);
    expect(uneven[1].width).toBeCloseTo(10017 / 30050, 10);
    expect(breakdownRows([])).toEqual([]);
    expect(BREAKDOWN_LIMIT).toBe(6);
  });

  it("a row click shows only that category; clicking the sole selected one clears it", () => {
    expect(soleCategoryToggle([], "food")).toEqual(["food"]);
    expect(soleCategoryToggle(["food"], "food")).toEqual([]);
    expect(soleCategoryToggle(["food"], "fun")).toEqual(["fun"]);
    expect(soleCategoryToggle(["food", "fun"], "food")).toEqual(["food"]);
  });
});

describe("view helpers", () => {
  const view = { range: { from: "2026-10-01", to: "2026-10-15" }, categoryIds: ["food"], accountId: "main" };

  it("explains why a saved spending is not visible", () => {
    expect(hiddenReason({ date: "2026-10-05", categoryId: "food", accountId: "main" }, view)).toBeNull();
    expect(hiddenReason({ date: "2026-09-30", categoryId: "food", accountId: "main" }, view)).toMatch(/30 Sep 2026/);
    expect(hiddenReason({ date: "2026-10-05", categoryId: "fun", accountId: "main" }, view)).toMatch(/category/);
    expect(hiddenReason({ date: "2026-10-05", categoryId: "food", accountId: "usd" }, view)).toMatch(/account/);
    expect(hiddenReason({ date: "2026-10-05", categoryId: "fun", accountId: "usd" }, { ...view, categoryIds: [], accountId: null })).toBeNull();
  });

  it("formats counts deterministically", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1234)).toBe("1\u00a0234");
    expect(formatCount(1234567)).toBe("1\u00a0234\u00a0567");
    expect(pluralize(1, "spending")).toBe("1 spending");
    expect(pluralize(2, "spending")).toBe("2 spendings");
    expect(pluralize(1200, "day")).toBe("1\u00a0200 days");
  });

  it("labels today and yesterday", () => {
    expect(relativeDayLabel("2026-10-15", "2026-10-15")).toBe("Today");
    expect(relativeDayLabel("2026-10-14", "2026-10-15")).toBe("Yesterday");
    expect(relativeDayLabel("2026-09-30", "2026-10-01")).toBe("Yesterday");
    expect(relativeDayLabel("2026-10-13", "2026-10-15")).toBeNull();
  });
});
