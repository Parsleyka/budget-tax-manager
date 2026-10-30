import { describe, expect, it } from "vitest";
import { account, category, expense, settings } from "@/test/factories";
import { formatBytes, inspectImportFile, plural } from "./import-file";

function exportText(over: { withRates?: boolean; danglingCategory?: boolean } = {}) {
  const main = account({ id: "acc-main" });
  const taxes = category({ id: "cat-taxes", name: "Taxes", systemKey: "taxes" });
  const food = category({ id: "cat-food", name: "Groceries" });
  const e = expense({ accountId: main.id, categoryId: over.danglingCategory ? "cat-missing" : food.id });
  return JSON.stringify({
    app: "budget-tax-manager",
    version: 1,
    exportedAt: "2026-10-15T10:00:00.000Z",
    data: {
      accounts: [main],
      incomes: [],
      expenses: [e],
      categories: [taxes, food],
      transfers: [],
      adjustments: [],
      settings: settings({ defaultActiveAccountId: main.id }),
      ...(over.withRates
        ? {
            rates: {
              version: 1,
              USD: { "2026-10-15": { rate: 44.9801, fetchedAt: "2026-10-15T10:00:00.000Z" } },
              EUR: {},
              meta: {},
            },
          }
        : {}),
    },
  });
}

describe("inspectImportFile", () => {
  it("summarises a valid export", () => {
    const res = inspectImportFile(exportText({ withRates: true }));
    expect(res).toEqual({
      ok: true,
      summary: {
        exportedAt: "2026-10-15T10:00:00.000Z",
        counts: { accounts: 1, incomes: 0, expenses: 1, categories: 2, transfers: 0, adjustments: 0, debts: 0, investmentFlows: 0, valuations: 0, rates: 1 },
      },
    });
  });

  it("reports a missing rates cache as null", () => {
    const res = inspectImportFile(exportText());
    expect(res.ok && res.summary.counts.rates).toBe(null);
  });

  it("rejects non-JSON, foreign JSON and broken references", () => {
    expect(inspectImportFile("not json")).toEqual({ ok: false, error: "The file is not valid JSON." });
    const foreign = inspectImportFile(JSON.stringify({ hello: "world" }));
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toMatch(/not a valid Budget & Tax export/);
    const dangling = inspectImportFile(exportText({ danglingCategory: true }));
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.error).toMatch(/integrity problems/);
  });
});

describe("formatting helpers", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(150 * 1024)).toBe("150 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
  it("pluralises", () => {
    expect(plural(1, "spending")).toBe("1 spending");
    expect(plural(3, "spending")).toBe("3 spendings");
    expect(plural(0, "category", "categories")).toBe("0 categories");
  });
});
