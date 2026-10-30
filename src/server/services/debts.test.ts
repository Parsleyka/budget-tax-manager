import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountBalance } from "@/lib/ledger";
import type { Account, DataSnapshot } from "@/lib/types";
import { readSnapshot } from "../db/store";
import * as accounts from "./accounts";
import { exportData, importData } from "./data-transfer";
import * as debts from "./debts";

let dir: string;
let s: DataSnapshot;
const acc = (name: string): Account => {
  const a = s.accounts.find((x) => x.name === name);
  if (!a) throw new Error(`no account ${name}`);
  return a;
};
const balance = async (name: string) => accountBalance(acc(name).id, await readSnapshot());

beforeEach(async () => {
  // "Today" is 2026-10-23 in Kyiv.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-23T09:00:00Z") });
  dir = await mkdtemp(path.join(os.tmpdir(), "budget-debts-test-"));
  process.env.BUDGET_DATA_DIR = dir;
  s = await readSnapshot(); // seeds
});
afterEach(async () => {
  vi.useRealTimers();
  delete process.env.BUDGET_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("debts service (separate tracker)", () => {
  it("lend, repay partly and fully, delete — the Main card balance never changes", async () => {
    const created = await debts.createDebt({
      direction: "lent",
      counterparty: "  Oleh  ",
      date: "2026-10-01",
      amount: 5000,
      currency: "UAH",
      dueDate: "2026-11-01",
      note: "",
      // A client still sending an account (older UI) is ignored.
      ...({ accountId: acc("Main card").id } as object),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data).toMatchObject({ counterparty: "Oleh", dueDate: "2026-11-01", repayments: [] });
    expect(created.data).not.toHaveProperty("accountId");
    expect(created.data.note).toBeUndefined();
    expect(await balance("Main card")).toBe(0);

    const r1 = await debts.addDebtRepayment(created.data.id, { date: "2026-10-10", amount: 2000 });
    expect(r1.ok).toBe(true);
    const r2 = await debts.addDebtRepayment(created.data.id, { date: "2026-10-12", amount: 500, note: "cash" });
    expect(r2.ok).toBe(true);
    expect(await balance("Main card")).toBe(0);

    const tooMuch = await debts.addDebtRepayment(created.data.id, { date: "2026-10-20", amount: 2500.01 });
    expect(tooMuch).toMatchObject({ ok: false });
    expect(!tooMuch.ok && tooMuch.fieldErrors?.amount?.[0]).toMatch(/Only 2/);

    // The amount can't drop below what was repaid.
    const shrink = await debts.updateDebt(created.data.id, { direction: "lent", counterparty: "Oleh", date: "2026-10-01", amount: 2400, currency: "UAH" });
    expect(!shrink.ok && shrink.fieldErrors?.amount).toBeTruthy();

    const repId = r2.ok ? r2.data.repayments.find((r) => r.note === "cash")!.id : "";
    const del = await debts.deleteDebtRepayment(created.data.id, repId);
    expect(del.ok && del.data.repayments).toHaveLength(1);
    const full = await debts.addDebtRepayment(created.data.id, { date: "2026-10-22", amount: 3000 });
    expect(full.ok && full.data.repayments).toHaveLength(2);
    expect((await debts.deleteDebt(created.data.id)).ok).toBe(true);
    expect(await balance("Main card")).toBe(0);
    expect((await readSnapshot()).debts).toEqual([]);
  });

  it("validates dates: no future debts, due date not before the debt, repayments not before the debt", async () => {
    const future = await debts.createDebt({ direction: "borrowed", counterparty: "Ira", date: "2026-10-24", amount: 100, currency: "USD" });
    expect(!future.ok && future.fieldErrors?.date).toBeTruthy();
    const badDue = await debts.createDebt({ direction: "borrowed", counterparty: "Ira", date: "2026-10-05", amount: 100, currency: "USD", dueDate: "2026-10-04" });
    expect(!badDue.ok && badDue.fieldErrors?.dueDate).toBeTruthy();

    const ok = await debts.createDebt({ direction: "borrowed", counterparty: "Ira", date: "2026-10-05", amount: 100, currency: "USD", dueDate: "2027-01-15" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const early = await debts.addDebtRepayment(ok.data.id, { date: "2026-10-04", amount: 10 });
    expect(!early.ok && early.fieldErrors?.date).toBeTruthy();
    expect((await debts.addDebtRepayment(ok.data.id, { date: "2026-10-20", amount: 100 })).ok).toBe(true);
    const again = await debts.addDebtRepayment(ok.data.id, { date: "2026-10-21", amount: 1 });
    expect(again).toMatchObject({ ok: false, error: "This debt is already fully repaid" });
    expect(await balance("FOP USD")).toBe(0);
  });

  it("a debts.json from the first version loads: the debt's own link is dropped, a repayment's link is kept", async () => {
    const main = acc("Main card").id;
    const legacy = {
      version: 1,
      items: [
        {
          id: "old-1",
          direction: "lent",
          counterparty: "Oleh",
          date: "2026-10-01",
          amount: 700,
          currency: "UAH",
          dueDate: "2026-12-01",
          accountId: main,
          repayments: [{ id: "rep-1", date: "2026-10-05", amount: 200, accountId: main, createdAt: "2026-10-05T10:00:00.000Z" }],
          createdAt: "2026-10-01T10:00:00.000Z",
          updatedAt: "2026-10-05T10:00:00.000Z",
        },
      ],
    };
    await writeFile(path.join(dir, "debts.json"), JSON.stringify(legacy));
    const snap = await readSnapshot();
    expect(snap.debts[0]).toMatchObject({ id: "old-1", counterparty: "Oleh", amount: 700, dueDate: "2026-12-01" });
    expect(snap.debts[0]).not.toHaveProperty("accountId");
    // Lending never moved the card; the 200 that came back into it did.
    expect(await balance("Main card")).toBe(200);
    // The next write stores the cleaned record (no account on the debt itself).
    expect((await debts.addDebtRepayment("old-1", { date: "2026-10-20", amount: 100 })).ok).toBe(true);
    const onDisk = JSON.parse(await readFile(path.join(dir, "debts.json"), "utf8"));
    expect(onDisk.items[0]).not.toHaveProperty("accountId");
    expect(onDisk.items[0].repayments).toHaveLength(2);
  });

  it("repayments into / from an account move its balance; another currency needs the account amount", async () => {
    const main = acc("Main card").id;
    const lent = await debts.createDebt({ direction: "lent", counterparty: "Oleh", date: "2026-10-01", amount: 5000, currency: "UAH" });
    const owed = await debts.createDebt({ direction: "borrowed", counterparty: "Kasia", date: "2026-10-01", amount: 1500, currency: "PLN" });
    if (!lent.ok || !owed.ok) throw new Error("setup");
    expect(await balance("Main card")).toBe(0);

    // Oleh paid back 2 000 ₴ into the card → +2 000.
    const r1 = await debts.addDebtRepayment(lent.data.id, { date: "2026-10-10", amount: 2000, accountId: main });
    expect(r1.ok && r1.data.repayments[0]).toMatchObject({ accountId: main, amount: 2000 });
    expect(await balance("Main card")).toBe(2000);

    // Paying 500 zł back from the UAH card needs the hryvnia amount.
    const missing = await debts.addDebtRepayment(owed.data.id, { date: "2026-10-12", amount: 500, accountId: main });
    expect(!missing.ok && missing.fieldErrors?.accountAmount?.[0]).toMatch(/Enter the amount in UAH/);
    const paid = await debts.addDebtRepayment(owed.data.id, { date: "2026-10-12", amount: 500, accountId: main, accountAmount: 5790 });
    expect(paid.ok && paid.data.repayments[0]).toMatchObject({ amount: 500, accountId: main, accountAmount: 5790 });
    expect(await balance("Main card")).toBe(2000 - 5790);

    // Same currency: an account amount is ignored (the repayment amount is what moved).
    const same = await debts.addDebtRepayment(lent.data.id, { date: "2026-10-13", amount: 100, accountId: main, accountAmount: 999 });
    expect(same.ok && same.data.repayments[1]).not.toHaveProperty("accountAmount");
    expect(await balance("Main card")).toBe(2000 - 5790 + 100);

    // An account used by a repayment can't be deleted (archive it instead).
    const cash = await accounts.createAccount({ name: "Cash", group: "other", currency: "UAH", openingBalance: 0 });
    if (!cash.ok) throw new Error("setup");
    expect((await debts.addDebtRepayment(lent.data.id, { date: "2026-10-14", amount: 50, accountId: cash.data.id })).ok).toBe(true);
    const del = await accounts.deleteAccount(cash.data.id);
    expect(!del.ok && del.error).toMatch(/1 debt repayments/);
    // Deleting a repayment puts the balance back.
    const r1Id = r1.ok ? r1.data.repayments[0].id : "";
    expect((await debts.deleteDebtRepayment(lent.data.id, r1Id)).ok).toBe(true);
    expect(await balance("Main card")).toBe(-5790 + 100);
    // Deleting the whole debt removes its repayments' effect too.
    expect((await debts.deleteDebt(owed.data.id)).ok).toBe(true);
    expect(await balance("Main card")).toBe(100);
  });

  it("an archived or unknown account is refused", async () => {
    const created = await accounts.createAccount({ name: "Old card", group: "other", currency: "UAH", openingBalance: 0 });
    if (!created.ok) throw new Error("setup");
    await accounts.archiveAccount(created.data.id, true);
    const d = await debts.createDebt({ direction: "lent", counterparty: "Max", date: "2026-10-01", amount: 300, currency: "UAH" });
    if (!d.ok) throw new Error("setup");
    const archived = await debts.addDebtRepayment(d.data.id, { date: "2026-10-05", amount: 100, accountId: created.data.id });
    expect(!archived.ok && archived.fieldErrors?.accountId?.[0]).toBe("This account is archived");
    const unknown = await debts.addDebtRepayment(d.data.id, { date: "2026-10-05", amount: 100, accountId: "nope" });
    expect(unknown.ok).toBe(false);
  });

  it("export → import round-trips debts; older exports without debts import as none", async () => {
    await debts.createDebt({ direction: "lent", counterparty: "Oleh", date: "2026-10-01", amount: 700, currency: "UAH", dueDate: "2026-12-01" });
    const file = await exportData();
    expect(file.data.debts).toHaveLength(1);
    const reimport = await importData(JSON.stringify(file));
    expect(reimport.ok && reimport.data.counts.debts).toBe(1);
    expect((await readSnapshot()).debts[0]).toMatchObject({ counterparty: "Oleh", amount: 700, dueDate: "2026-12-01" });

    const { debts: _omit, ...legacyData } = file.data;
    void _omit;
    const legacy = await importData(JSON.stringify({ ...file, data: legacyData }));
    expect(legacy.ok && legacy.data.counts.debts).toBe(0);
    expect((await readSnapshot()).debts).toEqual([]);
    expect(JSON.parse(await readFile(path.join(dir, "debts.json"), "utf8"))).toEqual({ version: 1, items: [] });
  });
});
