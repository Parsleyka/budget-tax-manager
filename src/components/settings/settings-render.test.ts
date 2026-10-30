/**
 * Render smoke test for the Settings page body (server-side render of all four tab panels, with
 * the Server Actions and next/link mocked). Catches hook/provider wiring mistakes and checks the
 * key content of a fresh install: default tax settings, rule tables, categories, data files.
 */
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { rulesTable } from "@/lib/tax/rules";
import type { Account, Category, Settings } from "@/lib/types";
import type { SettingsPageData } from "@/server/queries";
import { CategoriesSection } from "./categories-section";
import { DataSection } from "./data-section";
import { GeneralSection } from "./general-section";
import { RulesTables } from "./rules-tables";
import { SettingsTabs } from "./settings-tabs";
import { parseSettingsTab } from "./tabs";
import { TaxSettingsForm } from "./tax-settings-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => h("a", { href, ...rest }, children),
}));
vi.mock("@/server/actions/settings", () => ({ updateSettings: vi.fn() }));
vi.mock("@/server/actions/data", () => ({ importData: vi.fn() }));
vi.mock("@/server/actions/categories", () => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  archiveCategory: vi.fn(),
  pinCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));

const TS = "2026-10-01T00:00:00.000Z";
const TODAY = "2026-10-15";
const taxes: Category = { id: "c-tax", name: "Taxes", color: "red", icon: "Landmark", systemKey: "taxes", archived: false, createdAt: TS, updatedAt: TS };
const groceries: Category = { id: "c-groc", name: "Groceries", color: "blue", icon: "ShoppingCart", archived: false, createdAt: TS, updatedAt: TS };
const old: Category = { id: "c-old", name: "Old stuff", color: "gray", archived: true, createdAt: TS, updatedAt: TS };
const main: Account = { id: "a-main", name: "Main card", group: "active", currency: "UAH", openingBalance: 0, archived: false, createdAt: TS, updatedAt: TS };
const usd: Account = { id: "a-usd", name: "FOP USD", group: "freelancer", currency: "USD", openingBalance: 0, archived: false, createdAt: TS, updatedAt: TS };
const noUsage = { incomes: 0, expenses: 0, transfers: 0, adjustments: 0, investments: 0, debts: 0, total: 0 };

function settings(tax: Partial<Settings["tax"]> = {}): Settings {
  return {
    tax: {
      vatPayer: false,
      singleTaxRateOverridePct: null,
      militaryLevyEnabled: true,
      militaryLevyRateOverridePct: null,
      militaryLevyEndDate: null,
      esvMode: "employed",
      employedFrom: null,
      employedTo: null,
      esvUncoveredMonths: [],
      esvCustomMonthlyBase: null,
      fopRegisteredOn: null,
      ...tax,
    },
    defaultActiveAccountId: main.id,
    createdAt: TS,
    updatedAt: TS,
  };
}

function pageData(over: Partial<SettingsPageData> = {}): SettingsPageData {
  return {
    today: TODAY,
    settings: settings(),
    categories: [
      { category: groceries, expenseCount: 0, totalUah: 0 },
      { category: taxes, expenseCount: 0, totalUah: 0 },
    ],
    accounts: [
      { account: main, usage: noUsage, balance: 1250.5, isDefault: true },
      { account: usd, usage: noUsage, balance: 0, isDefault: false },
    ],
    dataDir: "/tmp/budget-data",
    files: [
      { name: "accounts.json", path: "/tmp/budget-data/accounts.json", exists: true, sizeBytes: 2048 },
      { name: "rates.json", path: "/tmp/budget-data/rates.json", exists: false, sizeBytes: null },
    ],
    rules: rulesTable(),
    ...over,
  };
}

function renderPage(data: SettingsPageData, tab = "taxes"): string {
  const page = h(SettingsTabs, {
    initialTab: parseSettingsTab(tab),
    panels: {
      taxes: h("div", null, h(TaxSettingsForm, { tax: data.settings.tax, today: data.today }), h(RulesTables, { rules: data.rules, today: data.today, tax: data.settings.tax })),
      categories: h(CategoriesSection, { categories: data.categories }),
      general: h(GeneralSection, { accounts: data.accounts, defaultActiveAccountId: data.settings.defaultActiveAccountId }),
      data: h(DataSection, { dataDir: data.dataDir, files: data.files }),
    },
  });
  return renderToStaticMarkup(h(TooltipProvider, null, page)).replace(/[  ]/g, " ");
}

describe("Settings page render", () => {
  it("renders every tab of a fresh install", () => {
    const html = renderPage(pageData());
    // Tabs (all panels mounted).
    for (const label of ["Taxes", "Categories", "General", "Data"]) expect(html).toContain(label);
    // Taxes: default employed mode; nothing set under "Advanced", so it starts collapsed; save bar.
    expect(html).toContain("Employed (employer pays ЄСВ)");
    expect(html).toContain("Advanced");
    expect(html).not.toContain("ЄСВ month by month");
    expect(html).toContain("Save tax settings");
    expect(html).toContain('id="esv"');
    // Rules tables.
    expect(html).toContain("8 647,00 ₴");
    expect(html).toContain("1 902,34 ₴");
    expect(html).toContain("5 707,02 ₴");
    expect(html).toContain("10 091 049,00 ₴");
    expect(html).toContain("https://zakon.rada.gov.ua/laws/show/4695-20");
    expect(html).toContain("Your settings use the statutory rates.");
    // Categories: Taxes is a system category; unused rows.
    expect(html).toContain("System");
    expect(html).toContain("Unused");
    // General: main account balance (Radix Select renders the chosen label only after mount).
    expect(html).toContain('id="default-account"');
    expect(html).toContain("1 250,50 ₴");
    // Data: folder, sizes, export link, import.
    expect(html).toContain("/tmp/budget-data");
    expect(html).toContain("2.0 KB");
    expect(html).toContain("Not created yet");
    expect(html).toContain('href="/api/export"');
    expect(html).toContain("Replace all data…");
  });

  it("shows overrides, uncovered months, custom mode and archived categories", () => {
    const data = pageData({
      settings: settings({
        esvMode: "custom",
        esvCustomMonthlyBase: 20000,
        singleTaxRateOverridePct: 4.5,
        militaryLevyEndDate: "2029-12-31",
      }),
      categories: [
        { category: groceries, expenseCount: 3, totalUah: 1234.5 },
        { category: old, expenseCount: 1, totalUah: 10 },
        { category: taxes, expenseCount: 0, totalUah: 0 },
      ],
    });
    const html = renderPage(data, "categories");
    expect(html).toContain("4,5%");
    expect(html).toContain("until 31 Dec 2029"); // save-bar summary
    expect(html).toContain("levy ends 31 Dec 2029"); // rules overrides line
    expect(html).toContain("Overridden in your settings");
    // custom base 20 000 → 22% = 4 400,00 per month.
    expect(html).toContain("4 400,00 ₴");
    expect(html).toContain("Archived");
    expect(html).toContain("1 234,50 ₴");
  });

  it("marks uncovered months in employed mode", () => {
    const html = renderPage(pageData({ settings: settings({ esvUncoveredMonths: ["2026-03", "2025-12"] }) }));
    // Something is set under "Advanced", so it starts open with the month-by-month editor.
    expect(html).toContain("ЄСВ month by month");
    expect(html.match(/>Covered</g)?.length).toBe(11);
    expect(html).toContain("2026 total: <span");
    expect(html.match(/>Not covered</g)?.length).toBe(1); // only March is in the 2026 grid
    expect(html).toContain("Dec 2025"); // listed in the chips
    expect(html).toContain("Remove March 2026");
  });

  it("falls back to the Taxes tab for an unknown ?tab=", () => {
    expect(parseSettingsTab("nope")).toBe("taxes");
    expect(parseSettingsTab(["data", "x"])).toBe("data");
    expect(parseSettingsTab(undefined)).toBe("taxes");
  });
});
