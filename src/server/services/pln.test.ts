import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeDebts } from "@/lib/debts";
import { balanceSheet } from "@/lib/ledger";
import { CURRENCY_SYMBOL, formatMoney } from "@/lib/money";
import { CurrencySchema, RatesCacheSchema } from "@/lib/schemas";
import { createNbuMock } from "@/test/nbu-mock";
import { readRatesCache, readSnapshot } from "../db/store";
import { isNbuCurrency } from "@/server/nbu";
import { getHeaderRates, getRate, resetNbuMemory } from "../nbu/rates";
import { fxFromHeaderRates } from "../queries";
import * as accounts from "./accounts";
import * as debts from "./debts";
import * as expenses from "./expenses";

let dir: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-23T09:00:00Z") });
  dir = await mkdtemp(path.join(os.tmpdir(), "budget-pln-test-"));
  process.env.BUDGET_DATA_DIR = dir;
  resetNbuMemory();
  const nbu = createNbuMock({
    USD: { "2026-10-22": 45.0256, "2026-10-23": 45.051 },
    EUR: { "2026-10-22": 50.56, "2026-10-23": 50.435 },
    PLN: { "2026-10-09": 11.6012, "2026-10-22": 11.5573, "2026-10-23": 11.5401 },
  });
  vi.stubGlobal("fetch", nbu.fetch);
  await readSnapshot(); // seeds
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.BUDGET_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("Polish złoty (PLN)", () => {
  it("is a supported currency with an NBU rate and a zł symbol", async () => {
    expect(CurrencySchema.safeParse("PLN").success).toBe(true);
    expect(isNbuCurrency("PLN")).toBe(true);
    expect(CURRENCY_SYMBOL.PLN).toBe("zł");
    expect(formatMoney(1234.5, "PLN").replace(/ /g, " ")).toBe("1 234,50 zł");
    expect(await getRate("PLN", "2026-10-23")).toMatchObject({ rate: 11.5401, stale: false });
    const h = await getHeaderRates("2026-10-23");
    expect(h.PLN).toMatchObject({ rate: 11.5401, change: -0.0172 });
    expect(fxFromHeaderRates(h).PLN).toMatchObject({ rate: 11.5401, stale: false });
  });

  it("a PLN account: spendings convert at that day's NBU rate and the balance counts in UAH", async () => {
    const acc = await accounts.createAccount({ name: "PKO PLN", group: "other", currency: "PLN", openingBalance: 1000 });
    expect(acc.ok).toBe(true);
    if (!acc.ok) return;
    const cat = (await readSnapshot()).categories.find((c) => c.name === "Groceries")!;
    const e = await expenses.createExpense({ date: "2026-10-09", amount: 100, accountId: acc.data.id, categoryId: cat.id });
    expect(e.ok && e.data).toMatchObject({ currency: "PLN", rate: 11.6012, amountUah: 1160.12 });
    const snap = await readSnapshot();
    const fx = fxFromHeaderRates(await getHeaderRates("2026-10-23"));
    const other = balanceSheet(snap, fx).frozenGroups.find((g) => g.group === "other")!;
    // 900 zł × 11,5401 = 10 386,09 ₴
    expect(other.accounts.find((a) => a.account.id === acc.data.id)).toMatchObject({ balance: 900, balanceUah: 10386.09 });
  });

  it("PLN debts are totalled in UAH at today's rate, and shown per currency", async () => {
    expect((await debts.createDebt({ direction: "borrowed", counterparty: "Kasia", date: "2026-10-01", amount: 2500, currency: "PLN" })).ok).toBe(true);
    expect((await debts.createDebt({ direction: "borrowed", counterparty: "Bank", date: "2026-10-01", amount: 1000, currency: "UAH" })).ok).toBe(true);
    const fx = fxFromHeaderRates(await getHeaderRates("2026-10-23"));
    const s = summarizeDebts((await readSnapshot()).debts, fx, "2026-10-23");
    // 2 500 zł × 11,5401 = 28 850,25 ₴ + 1 000 ₴
    expect(s.borrowed).toMatchObject({ byCurrency: { PLN: 2500, UAH: 1000 }, totalUah: 29850.25, incomplete: false });
  });

  it("a rates cache written before PLN existed still loads (PLN starts empty)", async () => {
    await writeFile(path.join(dir, "rates.json"), JSON.stringify({ version: 1, USD: {}, EUR: {}, meta: {} }));
    expect(await readRatesCache()).toEqual({ version: 1, USD: {}, EUR: {}, PLN: {}, meta: {} });
    expect(RatesCacheSchema.parse({ version: 1, USD: {}, EUR: {}, meta: {} }).PLN).toEqual({});
  });
});
