import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNbuMock } from "@/test/nbu-mock";
import { accountBalance } from "@/lib/ledger";
import type { Account, DataSnapshot } from "@/lib/types";
import { readSnapshot } from "../db/store";
import { resetNbuMemory } from "../nbu/rates";
import * as accounts from "./accounts";
import * as categories from "./categories";
import { exportData, importData } from "./data-transfer";
import * as expenses from "./expenses";
import * as incomes from "./incomes";
import { updateSettings } from "./settings";
import * as transfers from "./transfers";

let dir: string;
let nbu: ReturnType<typeof createNbuMock>;
let s: DataSnapshot;
const acc = (name: string): Account => {
  const a = s.accounts.find((x) => x.name === name);
  if (!a) throw new Error(`no account ${name}`);
  return a;
};
const cat = (name: string) => s.categories.find((c) => c.name === name)!;

beforeEach(async () => {
  // Only Date is faked (timers stay real for NBU timeouts): "today" is 2026-10-15 in Kyiv.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-15T09:00:00Z") });
  dir = await mkdtemp(path.join(os.tmpdir(), "budget-services-test-"));
  process.env.BUDGET_DATA_DIR = dir;
  resetNbuMemory();
  nbu = createNbuMock({ USD: { "2026-10-09": 44.8526, "2026-10-15": 44.9801 }, EUR: { "2026-10-09": 52.3456 } });
  vi.stubGlobal("fetch", nbu.fetch);
  s = await readSnapshot(); // seeds
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.BUDGET_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("incomes", () => {
  it("freelance FX income: the NBU rate is re-resolved server-side (client rate ignored)", async () => {
    const r = await incomes.createIncome({
      kind: "freelance",
      date: "2026-10-09",
      amount: 1234.56,
      currency: "USD",
      accountId: acc("FOP USD").id,
      rate: 50, // forged
      rateSource: "nbu",
      fee: 12.5,
      counterparty: "ACME",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ rate: 44.8526, rateSource: "nbu", amountUah: 55373.23, fee: 12.5, counterparty: "ACME" });
    const stored = (await readSnapshot()).incomes;
    expect(stored).toHaveLength(1);
  });
  it("manual rate is trusted when rateSource = manual", async () => {
    const r = await incomes.createIncome({
      kind: "freelance",
      date: "2026-10-09",
      amount: 100,
      currency: "EUR",
      accountId: acc("FOP EUR").id,
      rate: 51.5,
      rateSource: "manual",
    });
    expect(r.ok && r.data).toMatchObject({ rate: 51.5, rateSource: "manual", amountUah: 5150 });
  });
  it("NBU unavailable → { ok:false, fieldErrors.rate } asking for a manual rate", async () => {
    nbu.when(() => true, new TypeError("offline"));
    const r = await incomes.createIncome({
      kind: "freelance",
      date: "2026-10-01",
      amount: 100,
      currency: "USD",
      accountId: acc("FOP USD").id,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.rate?.[0]).toMatch(/manually/);
  });
  it("a stale fallback rate is not accepted for the tax base", async () => {
    // Cache 09.10, then NBU goes offline: 12.10 can only fall back to the older cached rate.
    expect((await incomes.createIncome({ kind: "freelance", date: "2026-10-09", amount: 1, currency: "USD", accountId: acc("FOP USD").id })).ok).toBe(true);
    nbu.when(() => true, new TypeError("offline"));
    const r = await incomes.createIncome({
      kind: "freelance",
      date: "2026-10-12",
      amount: 100,
      currency: "USD",
      accountId: acc("FOP USD").id,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not available yet/);
  });
  it("currency must equal the account currency; salary only UAH", async () => {
    const mismatch = await incomes.createIncome({
      kind: "freelance",
      date: "2026-10-09",
      amount: 100,
      currency: "EUR",
      accountId: acc("FOP USD").id,
    });
    expect(!mismatch.ok && mismatch.fieldErrors).toHaveProperty("currency");
    const salary = await incomes.createIncome({ kind: "salary", date: "2026-10-09", amount: 100, currency: "USD", accountId: acc("FOP USD").id });
    expect(salary.ok).toBe(false);
    const ok = await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 45000, currency: "UAH", accountId: acc("Main card").id });
    expect(ok.ok && ok.data).toMatchObject({ rate: 1, amountUah: 45000 });
    expect(nbu.fetch).not.toHaveBeenCalled();
  });
  it("invalid input → fieldErrors from zod", async () => {
    const r = await incomes.createIncome({ kind: "freelance", date: "2026-02-30", amount: 1.234, currency: "USD", accountId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["accountId", "amount", "date"]);
  });
  it("update keeps createdAt; delete removes", async () => {
    const created = await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 100, currency: "UAH", accountId: acc("Main card").id });
    if (!created.ok) throw new Error(created.error);
    const updated = await incomes.updateIncome(created.data.id, {
      kind: "salary",
      date: "2026-10-06",
      amount: 200,
      currency: "UAH",
      accountId: acc("Main card").id,
    });
    expect(updated.ok && updated.data).toMatchObject({ id: created.data.id, amount: 200, createdAt: created.data.createdAt });
    expect((await incomes.deleteIncome(created.data.id)).ok).toBe(true);
    expect((await incomes.deleteIncome(created.data.id)).ok).toBe(false);
    expect((await incomes.updateIncome("missing", { kind: "salary", date: "2026-10-06", amount: 1, currency: "UAH", accountId: acc("Main card").id })).ok).toBe(false);
  });
});

describe("expenses & tax payments", () => {
  it("currency comes from the account; FX expenses get the NBU rate", async () => {
    const uah = await expenses.createExpense({ date: "2026-10-09", amount: 99.99, accountId: acc("Main card").id, categoryId: cat("Groceries").id });
    expect(uah.ok && uah.data).toMatchObject({ currency: "UAH", rate: 1, amountUah: 99.99 });
    const usd = await expenses.createExpense({ date: "2026-10-09", amount: 10, accountId: acc("IBKR").id, categoryId: cat("Other").id });
    expect(usd.ok && usd.data).toMatchObject({ currency: "USD", rate: 44.8526, rateSource: "nbu", amountUah: 448.53 });
  });
  it("unknown / archived category is rejected", async () => {
    const r = await expenses.createExpense({ date: "2026-10-09", amount: 1, accountId: acc("Main card").id, categoryId: "nope" });
    expect(!r.ok && r.fieldErrors).toHaveProperty("categoryId");
    await categories.archiveCategory(cat("Travel").id, true);
    const r2 = await expenses.createExpense({ date: "2026-10-09", amount: 1, accountId: acc("Main card").id, categoryId: cat("Travel").id });
    expect(r2.ok).toBe(false);
  });
  it("recordTaxPayment creates one Taxes expense per line with taxMeta", async () => {
    const r = await expenses.recordTaxPayment({
      date: "2026-10-15",
      accountId: acc("Main card").id,
      period: "2026-Q3",
      payments: [
        { kind: "single_tax", amount: 2249.01 },
        { kind: "military_levy", amount: 449.8 },
        { kind: "esv", amount: 5707.02 },
      ],
    });
    expect(r.ok).toBe(true);
    const stored = (await readSnapshot()).expenses;
    expect(stored).toHaveLength(3);
    expect(stored.every((e) => e.categoryId === cat("Taxes").id && e.currency === "UAH")).toBe(true);
    expect(stored.map((e) => e.taxMeta)).toEqual([
      { kind: "single_tax", period: "2026-Q3" },
      { kind: "military_levy", period: "2026-Q3" },
      { kind: "esv", period: "2026-Q3" },
    ]);
    expect(stored[0].note).toBe("Single tax — Q3 2026");
  });
  it("tax payments must come from a UAH account", async () => {
    const r = await expenses.recordTaxPayment({ date: "2026-10-15", accountId: acc("FOP USD").id, period: "2026-Q3", payments: [{ kind: "esv", amount: 1 }] });
    expect(!r.ok && r.fieldErrors).toHaveProperty("accountId");
  });
  it("moving a tax payment out of Taxes drops taxMeta", async () => {
    await expenses.recordTaxPayment({ date: "2026-10-15", accountId: acc("Main card").id, period: "2026-Q3", payments: [{ kind: "esv", amount: 10 }] });
    const e = (await readSnapshot()).expenses[0];
    const r = await expenses.updateExpense(e.id, { date: e.date, amount: 10, accountId: e.accountId, categoryId: cat("Other").id });
    expect(r.ok && r.data.taxMeta).toBeUndefined();
  });
});

describe("accounts, categories, transfers, adjustments", () => {
  it("cannot delete a referenced account (archive instead); can delete an unused one", async () => {
    await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 100, currency: "UAH", accountId: acc("Deposits").id });
    const r = await accounts.deleteAccount(acc("Deposits").id);
    expect(!r.ok && r.error).toMatch(/Archive it instead/);
    expect((await accounts.archiveAccount(acc("Deposits").id, true)).ok).toBe(true);
    expect((await accounts.deleteAccount(acc("Other").id)).ok).toBe(true);
    expect((await accounts.deleteAccount(acc("Main card").id)).ok).toBe(false); // default account
    expect((await accounts.archiveAccount(acc("Main card").id)).ok).toBe(false);
  });
  it("active accounts must be UAH; currency locked once used", async () => {
    const bad = await accounts.createAccount({ name: "X", group: "active", currency: "USD" });
    expect(!bad.ok && bad.fieldErrors).toHaveProperty("currency");
    await expenses.createExpense({ date: "2026-10-09", amount: 1, accountId: acc("IBKR").id, categoryId: cat("Other").id });
    const change = await accounts.updateAccount(acc("IBKR").id, { name: "IBKR", group: "ibkr", currency: "EUR" });
    expect(change.ok).toBe(false);
    const rename = await accounts.updateAccount(acc("IBKR").id, { name: "Interactive Brokers", group: "ibkr", currency: "USD", openingBalance: 10 });
    expect(rename.ok && rename.data).toMatchObject({ name: "Interactive Brokers", openingBalance: 10 });
  });
  it("categories: unique names, Taxes protected, delete only when unused", async () => {
    expect((await categories.createCategory({ name: "groceries", color: "blue" })).ok).toBe(false);
    const pets = await categories.createCategory({ name: "Pets", color: "green", icon: "PawPrint" });
    expect(pets.ok).toBe(true);
    expect((await categories.deleteCategory(cat("Taxes").id)).ok).toBe(false);
    expect((await categories.archiveCategory(cat("Taxes").id)).ok).toBe(false);
    const renamed = await categories.updateCategory(cat("Taxes").id, { name: "Податки", color: "red" });
    expect(renamed.ok && renamed.data).toMatchObject({ name: "Податки", systemKey: "taxes" });
    await expenses.createExpense({ date: "2026-10-09", amount: 1, accountId: acc("Main card").id, categoryId: cat("Health").id });
    expect((await categories.deleteCategory(cat("Health").id)).ok).toBe(false);
    if (pets.ok) expect((await categories.deleteCategory(pets.data.id)).ok).toBe(true);
  });
  it("categories: pin / unpin; edits keep the pin; an archived category can't be pinned but keeps its pin", async () => {
    const cash = cat("Cash withdrawal");
    expect(cash).toMatchObject({ color: "green", icon: "Banknote" });
    const pin = await categories.pinCategory(cash.id, true);
    expect(pin.ok && pin.data.pinned).toBe(true);
    const renamed = await categories.updateCategory(cash.id, { name: "Cash (ATM)", color: "green", icon: "Banknote" });
    expect(renamed.ok && renamed.data).toMatchObject({ name: "Cash (ATM)", pinned: true });
    const unpin = await categories.pinCategory(cash.id, false);
    expect(unpin.ok && "pinned" in unpin.data).toBe(false);
    expect((await categories.pinCategory(cash.id, "yes")).ok).toBe(false);
    expect((await categories.pinCategory("missing")).ok).toBe(false);

    await categories.pinCategory(cat("Travel").id);
    await categories.archiveCategory(cat("Travel").id, true);
    const archivedPin = await categories.pinCategory(cat("Gifts").id);
    expect(archivedPin.ok).toBe(true);
    await categories.archiveCategory(cat("Gifts").id, true);
    const refused = await categories.pinCategory(cat("Gifts").id, true);
    expect(!refused.ok && refused.error).toMatch(/archived — restore it to pin it/);
    expect((await categories.pinCategory(cat("Gifts").id, false)).ok).toBe(true); // unpinning is allowed
    const restored = await categories.archiveCategory(cat("Travel").id, false);
    expect(restored.ok && restored.data.pinned).toBe(true);

    // Export → import keeps the flag.
    const again = await importData(JSON.stringify(await exportData()));
    expect(again.ok).toBe(true);
    expect((await readSnapshot()).categories.find((c) => c.name === "Travel")?.pinned).toBe(true);
  });
  it("transfers: different accounts; same currency → equal amounts; FX needs toAmount", async () => {
    const same = await transfers.createTransfer({ date: "2026-10-09", fromAccountId: acc("Main card").id, toAccountId: acc("Main card").id, fromAmount: 1 });
    expect(same.ok).toBe(false);
    const uah = await transfers.createTransfer({ date: "2026-10-09", fromAccountId: acc("Main card").id, toAccountId: acc("Deposits").id, fromAmount: 500 });
    expect(uah.ok && uah.data.toAmount).toBe(500);
    const fxMissing = await transfers.createTransfer({ date: "2026-10-09", fromAccountId: acc("FOP USD").id, toAccountId: acc("Main card").id, fromAmount: 100 });
    expect(!fxMissing.ok && fxMissing.fieldErrors).toHaveProperty("toAmount");
    const fx = await transfers.createTransfer({ date: "2026-10-09", fromAccountId: acc("FOP USD").id, toAccountId: acc("Main card").id, fromAmount: 100, toAmount: 4480 });
    expect(fx.ok).toBe(true);
    if (fx.ok) expect((await transfers.deleteTransfer(fx.data.id)).ok).toBe(true);
  });
  it("setActualBalance stores delta = new − current", async () => {
    await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 1000, currency: "UAH", accountId: acc("Main card").id });
    const r = await accounts.setActualBalance({ accountId: acc("Main card").id, date: "2026-10-15", newBalance: 875.5 });
    expect(r.ok && r.data.delta).toBe(-124.5);
    const same = await accounts.setActualBalance({ accountId: acc("Main card").id, date: "2026-10-15", newBalance: 875.5 });
    expect(!same.ok && same.fieldErrors).toHaveProperty("newBalance");
    if (r.ok) expect((await accounts.deleteAdjustment(r.data.id)).ok).toBe(true);
  });
});

describe("settings", () => {
  it("patches and validates", async () => {
    const ok = await updateSettings({ tax: { vatPayer: true, esvUncoveredMonths: ["2026-05", "2026-02", "2026-05"] } });
    expect(ok.ok && ok.data.tax).toMatchObject({ vatPayer: true, esvUncoveredMonths: ["2026-02", "2026-05"], esvMode: "employed" });
    const window = await updateSettings({ tax: { employedFrom: "2026-05-01", employedTo: "2026-01-01" } });
    expect(!window.ok && window.fieldErrors).toHaveProperty(["tax.employedTo"]);
    const custom = await updateSettings({ tax: { esvMode: "custom" } });
    expect(!custom.ok && custom.fieldErrors).toHaveProperty(["tax.esvCustomMonthlyBase"]);
    const badDefault = await updateSettings({ defaultActiveAccountId: acc("FOP USD").id });
    expect(!badDefault.ok && badDefault.fieldErrors).toHaveProperty("defaultActiveAccountId");
  });

  it("TAX-5: keeps the military-service flag of an exempt period", async () => {
    const periods = [{ from: "2025-03", to: "2025-05", note: "Mobilised", militaryService: true }, { from: "2026-01", to: null }];
    const r = await updateSettings({ tax: { esvExemptPeriods: periods } });
    expect(r.ok && r.data.tax.esvExemptPeriods).toEqual(periods);
    const reset = await updateSettings({ tax: { esvExemptPeriods: [] } });
    expect(reset.ok && reset.data.tax.esvExemptPeriods).toEqual([]);
  });
});

describe("export / import", () => {
  it("rejects an invalid payload without touching files", async () => {
    const before = await readFile(path.join(dir, "accounts.json"), "utf8");
    expect((await importData("{nope")).ok).toBe(false);
    expect((await importData({ app: "budget-tax-manager", version: 1 })).ok).toBe(false);
    const exported = await exportData();
    exported.data.expenses.push({
      id: "dangling",
      date: "2026-10-01",
      amount: 1,
      currency: "UAH",
      rate: 1,
      amountUah: 1,
      categoryId: "ghost",
      accountId: exported.data.accounts[0].id,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const r = await importData(JSON.stringify(exported));
    expect(!r.ok && r.error).toMatch(/unknown category ghost/);
    expect(await readFile(path.join(dir, "accounts.json"), "utf8")).toBe(before);
    expect((await readdir(dir)).includes("backups")).toBe(false);
  });
  it("backs up current files then replaces everything", async () => {
    await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 1000, currency: "UAH", accountId: acc("Main card").id });
    const exported = await exportData();
    expect(exported).toMatchObject({ app: "budget-tax-manager", version: 1 });
    expect(exported.data.incomes).toHaveLength(1);
    // change state, then import the earlier export
    await incomes.createIncome({ kind: "salary", date: "2026-10-06", amount: 5, currency: "UAH", accountId: acc("Main card").id });
    const r = await importData(exported);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.counts).toMatchObject({ accounts: 7, incomes: 1, categories: 15 });
    expect((await readSnapshot()).incomes).toHaveLength(1);
    const backup = await readdir(r.data.backupDir);
    expect(backup).toEqual(expect.arrayContaining(["accounts.json", "incomes.json", "settings.json"]));
    const backedUp = JSON.parse(await readFile(path.join(r.data.backupDir, "incomes.json"), "utf8"));
    expect(backedUp.items).toHaveLength(2);
  });
  it("corrupt data file → actions fail cleanly without overwriting", async () => {
    await writeFile(path.join(dir, "incomes.json"), "{broken");
    const r = await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 1, currency: "UAH", accountId: acc("Main card").id });
    expect(!r.ok && r.error).toMatch(/corrupt or invalid/);
    expect(await readFile(path.join(dir, "incomes.json"), "utf8")).toBe("{broken");
  });
});

// ------------------------------------------------------------------ review fixes

describe("LEDGER-1 / JOURNEY-1: Update balance as of a past date", () => {
  it("measures the change against the balance on that date, so later movements still count", async () => {
    const deposits = acc("Deposits").id;
    expect((await accounts.setActualBalance({ accountId: deposits, date: "2026-10-01", newBalance: 100000 })).ok).toBe(true);
    const t = await transfers.createTransfer({ date: "2026-10-10", fromAccountId: acc("Main card").id, toAccountId: deposits, fromAmount: 5000 });
    expect(t.ok).toBe(true);
    // Statement value on 5 Oct (interest): 101 200.
    const r = await accounts.setActualBalance({ accountId: deposits, date: "2026-10-05", newBalance: 101200, note: "Interest" });
    expect(r.ok && r.data).toMatchObject({ date: "2026-10-05", delta: 1200 });
    const snap = await readSnapshot();
    expect(accountBalance(deposits, snap, { asOf: "2026-10-05" })).toBe(101200);
    expect(accountBalance(deposits, snap)).toBe(106200);
    // The preview helper agrees with what will be stored.
    expect(await accounts.balanceOn(deposits, "2026-10-05")).toEqual({ ok: true, data: 101200 });
    expect(await accounts.balanceOn(deposits, "2026-10-15")).toEqual({ ok: true, data: 106200 });
    // Entering the as-of balance again is refused with the date in the message.
    const same = await accounts.setActualBalance({ accountId: deposits, date: "2026-10-05", newBalance: 101200 });
    expect(!same.ok && same.fieldErrors?.newBalance?.[0]).toMatch(/^The balance on 5 Oct 2026 is already 101\s200,00\s₴$/);
  });
});

describe("LEDGER-2 / JOURNEY-2: no future-dated records", () => {
  it("refuses a date after today (Kyiv) for every kind of record", async () => {
    const main = acc("Main card").id;
    const future = "2026-10-16";
    const results = [
      await incomes.createIncome({ kind: "salary", date: future, amount: 1, currency: "UAH", accountId: main }),
      await expenses.createExpense({ date: future, amount: 1, accountId: main, categoryId: cat("Groceries").id }),
      await transfers.createTransfer({ date: future, fromAccountId: main, toAccountId: acc("Deposits").id, fromAmount: 1 }),
      await expenses.recordTaxPayment({ date: future, accountId: main, period: "2026-Q3", payments: [{ kind: "esv", amount: 1 }] }),
      await accounts.setActualBalance({ accountId: main, date: future, newBalance: 5 }),
    ];
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.fieldErrors?.date?.[0]).toMatch(/cannot be in the future/);
    }
    const snap = await readSnapshot();
    expect(snap.incomes.length + snap.expenses.length + snap.transfers.length + snap.adjustments.length).toBe(0);
    expect((await expenses.createExpense({ date: "2026-10-15", amount: 1, accountId: main, categoryId: cat("Groceries").id })).ok).toBe(true);
  });
  it("an older record that already has a future date can still be edited without moving it further", async () => {
    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
    const created = await expenses.createExpense({ date: "2026-10-20", amount: 300, accountId: acc("Main card").id, categoryId: cat("Groceries").id });
    if (!created.ok) throw new Error(created.error);
    vi.setSystemTime(new Date("2026-10-15T09:00:00Z"));
    const input = { date: "2026-10-20", amount: 310, accountId: acc("Main card").id, categoryId: cat("Groceries").id };
    expect((await expenses.updateExpense(created.data.id, input)).ok).toBe(true);
    expect((await expenses.updateExpense(created.data.id, { ...input, date: "2026-10-21" })).ok).toBe(false);
  });
});

describe("DATA-03: derived amounts are checked before writing", () => {
  it("amount × rate over the bound → a field error, not an internal error with a file path", async () => {
    const r = await incomes.createIncome({
      kind: "freelance",
      date: "2026-10-09",
      amount: 1e12,
      currency: "USD",
      rateSource: "manual",
      rate: 44,
      accountId: acc("FOP USD").id,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors?.amount).toEqual(["The amount in UAH is too large"]);
    expect(r.error).not.toMatch(/Unexpected|Refusing|\.json/);
    const e = await expenses.createExpense({ date: "2026-10-09", amount: 2e10, accountId: acc("IBKR").id, categoryId: cat("Other").id, rateSource: "manual", rate: 999 });
    expect(!e.ok && e.fieldErrors?.amount).toEqual(["The amount in UAH is too large"]);
  });
  it("a balance change over the bound → fieldErrors.newBalance", async () => {
    const main = acc("Main card").id;
    expect((await accounts.setActualBalance({ accountId: main, date: "2026-10-15", newBalance: -1e12 })).ok).toBe(true);
    const r = await accounts.setActualBalance({ accountId: main, date: "2026-10-15", newBalance: 1e12 });
    expect(!r.ok && r.fieldErrors?.newBalance).toEqual(["The change from the current balance is too large"]);
  });
});

describe("DATA-01: import is all-or-nothing", () => {
  it("restores every replaced file when a later write fails, and says where the backup is", async () => {
    await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 1000, currency: "UAH", accountId: acc("Main card").id });
    const before = await readSnapshot();
    const filesBefore = Object.fromEntries(
      await Promise.all(["accounts.json", "categories.json", "incomes.json", "settings.json"].map(async (f) => [f, await readFile(path.join(dir, f), "utf8")])),
    );
    // Dataset B: different ids (a fresh seed in another data dir) with a 7 UAH salary.
    const other = await mkdtemp(path.join(os.tmpdir(), "budget-services-b-"));
    process.env.BUDGET_DATA_DIR = other;
    const sB = await readSnapshot();
    await incomes.createIncome({ kind: "salary", date: "2026-10-05", amount: 7, currency: "UAH", accountId: sB.accounts.find((a) => a.name === "Main card")!.id });
    const exportB = await exportData();
    process.env.BUDGET_DATA_DIR = dir;
    await rm(other, { recursive: true, force: true });

    // The 4th file cannot be replaced: its one-step ".bak" path is a directory.
    await mkdir(path.join(dir, "expenses.json.bak"));
    const r = await importData(JSON.stringify(exportB));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/^Import failed \(.*\)\. Nothing was changed — your previous data was restored\. A backup is in .*backups/);

    const after = await readSnapshot();
    expect(after).toEqual(before);
    for (const [f, content] of Object.entries(filesBefore)) expect(await readFile(path.join(dir, f), "utf8")).toBe(content);
  });
});

describe("JOURNEY-6: a Taxes spending can be linked to its quarter", () => {
  it("create / edit / unlink via the spending form; only Taxes + UAH", async () => {
    const main = acc("Main card").id;
    const taxes = cat("Taxes").id;
    const created = await expenses.createExpense({
      date: "2026-10-15",
      amount: 1902.34,
      accountId: main,
      categoryId: taxes,
      taxMeta: { kind: "esv", period: "2026-Q3" },
    });
    expect(created.ok && created.data.taxMeta).toEqual({ kind: "esv", period: "2026-Q3" });
    if (!created.ok) return;
    const base = { date: "2026-10-15", amount: 1902.34, accountId: main, categoryId: taxes };
    // Omitted → kept; explicit → changed; null → unlinked.
    expect((await expenses.updateExpense(created.data.id, base)).ok && (await readSnapshot()).expenses[0].taxMeta).toEqual({ kind: "esv", period: "2026-Q3" });
    const moved = await expenses.updateExpense(created.data.id, { ...base, taxMeta: { kind: "single_tax", period: "2026-Q2" } });
    expect(moved.ok && moved.data.taxMeta).toEqual({ kind: "single_tax", period: "2026-Q2" });
    const unlinked = await expenses.updateExpense(created.data.id, { ...base, taxMeta: null });
    expect(unlinked.ok && unlinked.data.taxMeta).toBeUndefined();
    // Not the Taxes category, or not a UAH account → refused.
    const wrongCat = await expenses.createExpense({ ...base, categoryId: cat("Other").id, taxMeta: { kind: "esv", period: "2026-Q3" } });
    expect(!wrongCat.ok && wrongCat.fieldErrors).toHaveProperty("taxMeta");
    const usd = await expenses.createExpense({ ...base, accountId: acc("IBKR").id, taxMeta: { kind: "esv", period: "2026-Q3" } });
    expect(!usd.ok && usd.fieldErrors).toHaveProperty("accountId");
  });
});
