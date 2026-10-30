import "server-only";
import { randomUUID } from "node:crypto";
import { SEED_CATEGORIES } from "@/lib/categories";
import type { Account, Category, Settings, TaxSettings } from "@/lib/types";

/** Seed accounts (SPEC §2 "Seed data"). "Main card" becomes defaultActiveAccountId. */
export function seedAccounts(now: string): Account[] {
  const make = (name: string, group: Account["group"], currency: Account["currency"]): Account => ({
    id: randomUUID(),
    name,
    group,
    currency,
    openingBalance: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  return [
    make("Main card", "active", "UAH"),
    make("FOP UAH", "freelancer", "UAH"),
    make("FOP USD", "freelancer", "USD"),
    make("FOP EUR", "freelancer", "EUR"),
    make("IBKR", "ibkr", "USD"),
    make("Deposits", "deposits", "UAH"),
    make("Other", "other", "UAH"),
  ];
}

export function seedCategories(now: string): Category[] {
  return SEED_CATEGORIES.map((c) => ({
    id: randomUUID(),
    name: c.name,
    color: c.color,
    icon: c.icon,
    ...(c.systemKey ? { systemKey: c.systemKey } : {}),
    archived: false,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Default tax settings. esvMode defaults to "employed": the SPEC's Settings comment and
 * research/tax-rules.md §4.3 both make it the default for this user (salaried job); the seed
 * line in SPEC that says "minimum" conflicts with them — see FOUNDATION_API.md.
 */
export const DEFAULT_TAX_SETTINGS: TaxSettings = {
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
  fopDeregisteredOn: null,
  esvExemptPeriods: [],
  esv2024OptOut: false,
};

/** Settings seed: default account = first non-archived UAH account in group "active" ("Main card"). */
export function seedSettings(accounts: readonly Account[], now: string): Settings {
  const main =
    accounts.find((a) => a.group === "active" && a.currency === "UAH" && !a.archived && a.name === "Main card") ??
    accounts.find((a) => a.group === "active" && a.currency === "UAH" && !a.archived);
  return {
    tax: { ...DEFAULT_TAX_SETTINGS, esvUncoveredMonths: [], esvExemptPeriods: [] },
    defaultActiveAccountId: main?.id ?? "",
    createdAt: now,
    updatedAt: now,
  };
}
