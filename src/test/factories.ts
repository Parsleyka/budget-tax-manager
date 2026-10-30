/** Test factories for domain entities (tests only). */
import { convertToUah } from "@/lib/money";
import type { Account, Adjustment, Category, Debt, DebtRepayment, Expense, Income, Settings, TaxSettings, Transfer } from "@/lib/types";

const TS = "2026-01-01T00:00:00.000Z";
let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export function account(over: Partial<Account> = {}): Account {
  return {
    id: nextId("acc"),
    name: "Main card",
    group: "active",
    currency: "UAH",
    openingBalance: 0,
    archived: false,
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export function income(over: Partial<Income> & { amount?: number; rate?: number } = {}): Income {
  const currency = over.currency ?? "UAH";
  const rate = over.rate ?? 1;
  const amount = over.amount ?? 1000;
  return {
    id: nextId("inc"),
    kind: "freelance",
    date: "2026-01-15",
    currency,
    rate,
    rateSource: "nbu",
    accountId: "acc-x",
    createdAt: TS,
    updatedAt: TS,
    ...over,
    amount,
    amountUah: over.amountUah ?? convertToUah(amount, rate),
  };
}

export function expense(over: Partial<Expense> = {}): Expense {
  const rate = over.rate ?? 1;
  const amount = over.amount ?? 100;
  return {
    id: nextId("exp"),
    date: "2026-01-15",
    currency: "UAH",
    rate,
    categoryId: "cat-x",
    accountId: "acc-x",
    createdAt: TS,
    updatedAt: TS,
    ...over,
    amount,
    amountUah: over.amountUah ?? convertToUah(amount, rate),
  };
}

export function category(over: Partial<Category> = {}): Category {
  return { id: nextId("cat"), name: "Groceries", color: "blue", archived: false, createdAt: TS, updatedAt: TS, ...over };
}

export function transfer(over: Partial<Transfer> = {}): Transfer {
  return {
    id: nextId("tr"),
    date: "2026-01-20",
    fromAccountId: "a",
    toAccountId: "b",
    fromAmount: 100,
    toAmount: 100,
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export function adjustment(over: Partial<Adjustment> = {}): Adjustment {
  return { id: nextId("adj"), date: "2026-01-25", accountId: "a", delta: 10, createdAt: TS, ...over };
}

export function repayment(over: Partial<DebtRepayment> = {}): DebtRepayment {
  return { id: nextId("rep"), date: "2026-02-01", amount: 100, createdAt: TS, ...over };
}

export function debt(over: Partial<Debt> = {}): Debt {
  return {
    id: nextId("debt"),
    direction: "lent",
    counterparty: "Oleh",
    date: "2026-01-10",
    amount: 1000,
    currency: "UAH",
    repayments: [],
    createdAt: TS,
    updatedAt: TS,
    ...over,
  };
}

export function taxSettings(over: Partial<TaxSettings> = {}): TaxSettings {
  return {
    vatPayer: false,
    singleTaxRateOverridePct: null,
    militaryLevyEnabled: true,
    militaryLevyRateOverridePct: null,
    militaryLevyEndDate: null,
    esvMode: "minimum",
    employedFrom: null,
    employedTo: null,
    esvUncoveredMonths: [],
    esvCustomMonthlyBase: null,
    fopRegisteredOn: null,
    fopDeregisteredOn: null,
    esvExemptPeriods: [],
    esv2024OptOut: false,
    ...over,
  };
}

export function settings(over: Partial<Settings> = {}, tax: Partial<TaxSettings> = {}): Settings {
  return { tax: taxSettings(tax), defaultActiveAccountId: "acc-main", createdAt: TS, updatedAt: TS, ...over };
}
