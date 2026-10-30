import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { investmentSummary } from "@/lib/investments";
import { accountBalance } from "@/lib/ledger";
import type { Account, DataSnapshot } from "@/lib/types";
import { readSnapshot } from "../db/store";
import * as accounts from "./accounts";
import { exportData, importData } from "./data-transfer";
import * as inv from "./investments";

let dir: string;
let s: DataSnapshot;
const acc = (name: string): Account => {
  const a = s.accounts.find((x) => x.name === name);
  if (!a) throw new Error(`no account ${name}`);
  return a;
};
const balance = async (name: string) => accountBalance(acc(name).id, await readSnapshot());
const summary = async () => {
  const snap = await readSnapshot();
  return investmentSummary(snap.accounts.find((a) => a.name === "IBKR")!, snap, "2026-10-23");
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-23T09:00:00Z") });
  dir = await mkdtemp(path.join(os.tmpdir(), "budget-investments-test-"));
  process.env.BUDGET_DATA_DIR = dir;
  s = await readSnapshot(); // seeds (IBKR is a USD account in group "ibkr")
});
afterEach(async () => {
  vi.useRealTimers();
  delete process.env.BUDGET_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("investments service", () => {
  it("outside deposits + a value update give the gain; a deposit from FOP USD is a real transfer", async () => {
    const ibkr = acc("IBKR").id;
    expect((await inv.addInvestmentFlow({ accountId: ibkr, kind: "deposit", date: "2024-03-01", amount: 5000 })).ok).toBe(true);
    expect((await inv.addInvestmentFlow({ accountId: ibkr, kind: "deposit", date: "2025-01-10", amount: 10000, note: "Bonus" })).ok).toBe(true);
    expect((await inv.setValuation({ accountId: ibkr, date: "2026-10-01", value: 20000 })).ok).toBe(true);
    expect(await summary()).toMatchObject({ value: 20000, netDeposited: 15000, gain: 5000 });

    // Deposit from FOP USD (same currency): FOP USD −1 000, IBKR +1 000, principal +1 000.
    const fromFop = await inv.addInvestmentFlow({ accountId: ibkr, kind: "deposit", date: "2026-10-10", amount: 1000, linkedAccountId: acc("FOP USD").id });
    expect(fromFop.ok && fromFop.data.stored).toBe("transfer");
    expect(await balance("FOP USD")).toBe(-1000);
    expect(await summary()).toMatchObject({ value: 21000, netDeposited: 16000, gain: 5000 });
  });

  it("a deposit from a UAH account needs the UAH amount (cross-currency)", async () => {
    const ibkr = acc("IBKR").id;
    const main = acc("Main card").id;
    const missing = await inv.addInvestmentFlow({ accountId: ibkr, kind: "deposit", date: "2026-10-10", amount: 100, linkedAccountId: main });
    expect(!missing.ok && missing.fieldErrors?.linkedAmount?.[0]).toMatch(/left Main card \(UAH\)/);
    const ok = await inv.addInvestmentFlow({ accountId: ibkr, kind: "deposit", date: "2026-10-10", amount: 100, linkedAccountId: main, linkedAmount: 4200 });
    expect(ok.ok && ok.data.stored === "transfer" && ok.data.transfer).toMatchObject({ fromAmount: 4200, toAmount: 100 });
    expect(await balance("Main card")).toBe(-4200);
    // A withdrawal to the card: IBKR −50 $, card +2 080 ₴.
    const w = await inv.addInvestmentFlow({ accountId: ibkr, kind: "withdrawal", date: "2026-10-20", amount: 50, linkedAccountId: main, linkedAmount: 2080 });
    expect(w.ok).toBe(true);
    expect(await balance("Main card")).toBe(-2120);
    expect(await summary()).toMatchObject({ value: 50, deposited: 100, withdrawn: 50, netDeposited: 50 });
  });

  it("only investment accounts; no future dates; one value per day (a second one replaces it)", async () => {
    const notInv = await inv.addInvestmentFlow({ accountId: acc("Main card").id, kind: "deposit", date: "2026-10-10", amount: 10 });
    expect(!notInv.ok && notInv.fieldErrors?.accountId?.[0]).toBe("Choose an investment or deposit account");
    const future = await inv.setValuation({ accountId: acc("IBKR").id, date: "2026-10-24", value: 1 });
    expect(!future.ok && future.fieldErrors?.date).toBeTruthy();
    const a = await inv.setValuation({ accountId: acc("IBKR").id, date: "2026-10-22", value: 900 });
    const b = await inv.setValuation({ accountId: acc("IBKR").id, date: "2026-10-22", value: 950, note: "after close" });
    expect(a.ok && b.ok && a.data.id === b.data.id).toBe(true);
    expect((await readSnapshot()).valuations).toHaveLength(1);
    expect(await summary()).toMatchObject({ value: 950 });
  });

  it("edit / delete outside deposits and value updates; the account is protected while it has them", async () => {
    const ibkr = acc("IBKR").id;
    const f = await inv.addInvestmentFlow({ accountId: ibkr, kind: "deposit", date: "2026-01-10", amount: 300 });
    if (!f.ok || f.data.stored !== "flow") throw new Error("expected a flow");
    const upd = await inv.updateInvestmentFlow(f.data.flow.id, { accountId: ibkr, kind: "deposit", date: "2026-01-11", amount: 350 });
    expect(upd.ok && upd.data).toMatchObject({ date: "2026-01-11", amount: 350 });
    const link = await inv.updateInvestmentFlow(f.data.flow.id, { accountId: ibkr, kind: "deposit", date: "2026-01-11", amount: 350, linkedAccountId: acc("FOP USD").id });
    expect(link.ok).toBe(false);

    const move = await accounts.updateAccount(ibkr, { name: "IBKR", group: "other", currency: "USD", openingBalance: 0 });
    expect(!move.ok && move.fieldErrors?.group).toBeTruthy();
    const del = await accounts.deleteAccount(ibkr);
    expect(!del.ok && del.error).toMatch(/1 investment records/);

    expect((await inv.deleteInvestmentFlow(f.data.flow.id)).ok).toBe(true);
    const v = await inv.setValuation({ accountId: ibkr, date: "2026-10-01", value: 400 });
    expect(v.ok && (await inv.deleteValuation(v.data.id)).ok).toBe(true);
    expect(await summary()).toMatchObject({ value: 0, netDeposited: 0 });
  });

  it("bank deposits are tracked too: top-ups from the card, the balance with interest, interest earned", async () => {
    const dep = acc("Deposits").id;
    const main = acc("Main card").id;
    // An old top-up from outside + a new one from the card (a real transfer: the card goes down).
    expect((await inv.addInvestmentFlow({ accountId: dep, kind: "deposit", date: "2026-03-01", amount: 50000 })).ok).toBe(true);
    const fromCard = await inv.addInvestmentFlow({ accountId: dep, kind: "deposit", date: "2026-10-01", amount: 20000, linkedAccountId: main });
    expect(fromCard.ok && fromCard.data.stored).toBe("transfer");
    expect(await balance("Main card")).toBe(-20000);
    // The bank shows 72 400 with interest → interest earned 2 400.
    expect((await inv.setValuation({ accountId: dep, date: "2026-10-20", value: 72400 })).ok).toBe(true);
    const snap = await readSnapshot();
    const s2 = investmentSummary(snap.accounts.find((a) => a.id === dep)!, snap, "2026-10-23");
    expect(s2).toMatchObject({ value: 72400, netDeposited: 70000, gain: 2400 });

    // Moving it between Investments and Deposits is fine; out of both is refused while it has records.
    const toInv = await accounts.updateAccount(dep, { name: "Deposits", group: "ibkr", currency: "UAH", openingBalance: 0 });
    expect(toInv.ok).toBe(true);
    const toOther = await accounts.updateAccount(dep, { name: "Deposits", group: "other", currency: "UAH", openingBalance: 0 });
    expect(!toOther.ok && toOther.fieldErrors?.group?.[0]).toMatch(/keep it in Investments or Deposits/);
  });

  it("Accounts → Update balance dated on/before a value update is refused (it would have no effect)", async () => {
    const dep = acc("Deposits").id;
    expect((await inv.setValuation({ accountId: dep, date: "2026-10-20", value: 1000 })).ok).toBe(true);
    const before = await accounts.setActualBalance({ accountId: dep, date: "2026-10-19", newBalance: 900 });
    expect(!before.ok && before.fieldErrors?.date?.[0]).toMatch(/value was set on 20 Oct 2026 on the Investments page/);
    // After the value update it works (a correction on top).
    const after = await accounts.setActualBalance({ accountId: dep, date: "2026-10-22", newBalance: 1050 });
    expect(after.ok && after.data.delta).toBe(50);
    expect(await balance("Deposits")).toBe(1050);
  });

  it("export → import round-trips investments; older exports without them import as none", async () => {
    const ibkr = acc("IBKR").id;
    await inv.addInvestmentFlow({ accountId: ibkr, kind: "deposit", date: "2025-01-10", amount: 10000 });
    await inv.setValuation({ accountId: ibkr, date: "2026-10-01", value: 12500 });
    const file = await exportData();
    expect(file.data.investmentFlows).toHaveLength(1);
    expect(file.data.valuations).toHaveLength(1);
    const again = await importData(JSON.stringify(file));
    expect(again.ok && again.data.counts).toMatchObject({ investmentFlows: 1, valuations: 1 });
    expect(await summary()).toMatchObject({ value: 12500, netDeposited: 10000, gain: 2500 });

    const { investmentFlows: _f, valuations: _v, ...legacyData } = file.data;
    void _f;
    void _v;
    const legacy = await importData(JSON.stringify({ ...file, data: legacyData }));
    expect(legacy.ok && legacy.data.counts).toMatchObject({ investmentFlows: 0, valuations: 0 });
    expect(await summary()).toMatchObject({ value: 0, netDeposited: 0 });
  });
});
