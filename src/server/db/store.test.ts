import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expense } from "@/test/factories";
import { DataFileError } from "./json-file";
import { withLock } from "./mutex";
import { expensesRepo } from "./repositories";
import {
  checkDataHealth,
  readCollection,
  readRatesCache,
  readSettings,
  readSnapshot,
  updateCollection,
  updateRatesCache,
  writeCollection,
} from "./store";

let dir: string;
const file = (name: string) => path.join(dir, name);
const readJson = async (name: string) => JSON.parse(await readFile(file(name), "utf8"));

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "budget-store-test-"));
  process.env.BUDGET_DATA_DIR = dir;
});
afterEach(async () => {
  delete process.env.BUDGET_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("seeding", () => {
  it("creates every missing file with the SPEC seed (no transactions)", async () => {
    const s = await readSnapshot();
    expect(s.accounts.map((a) => [a.name, a.group, a.currency, a.openingBalance])).toEqual([
      ["Main card", "active", "UAH", 0],
      ["FOP UAH", "freelancer", "UAH", 0],
      ["FOP USD", "freelancer", "USD", 0],
      ["FOP EUR", "freelancer", "EUR", 0],
      ["IBKR", "ibkr", "USD", 0],
      ["Deposits", "deposits", "UAH", 0],
      ["Other", "other", "UAH", 0],
    ]);
    expect(s.categories).toHaveLength(15);
    expect(s.categories.filter((c) => c.systemKey === "taxes").map((c) => c.name)).toEqual(["Taxes"]);
    expect(new Set(s.categories.map((c) => c.icon)).size).toBe(15);
    expect(s.settings.defaultActiveAccountId).toBe(s.accounts[0].id);
    expect(s.settings.tax).toMatchObject({ vatPayer: false, singleTaxRateOverridePct: null, militaryLevyEnabled: true, esvMode: "employed" });
    expect(s.incomes).toEqual([]);
    expect(s.expenses).toEqual([]);
    expect(s.debts).toEqual([]);
    expect(s.investmentFlows).toEqual([]);
    expect(s.valuations).toEqual([]);
    const files = (await readdir(dir)).sort();
    expect(files).toEqual([
      "accounts.json",
      "adjustments.json",
      "categories.json",
      "debts.json",
      "expenses.json",
      "incomes.json",
      "investment-flows.json",
      "settings.json",
      "transfers.json",
      "valuations.json",
    ]);
    expect(await readJson("expenses.json")).toEqual({ version: 1, items: [] });
    expect((await readJson("settings.json")).version).toBe(1);
  });

  it("seeds exactly once under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => readCollection("accounts")));
    const ids = new Set(results.map((r) => r.map((a) => a.id).join(",")));
    expect(ids.size).toBe(1);
  });

  it("never overwrites an existing file", async () => {
    const mine = {
      version: 1,
      items: [
        {
          id: "my-card",
          name: "My card",
          group: "active",
          currency: "UAH",
          openingBalance: 5,
          archived: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    await writeFile(file("accounts.json"), JSON.stringify(mine));
    const accounts = await readCollection("accounts");
    expect(accounts.map((a) => a.id)).toEqual(["my-card"]);
    expect((await readSettings()).defaultActiveAccountId).toBe("my-card");
    expect(await readJson("accounts.json")).toEqual(mine);
  });

  it("missing rates.json is an empty cache (not created on read)", async () => {
    expect(await readRatesCache()).toEqual({ version: 1, USD: {}, EUR: {}, PLN: {}, meta: {} });
    expect((await readdir(dir)).includes("rates.json")).toBe(false);
  });
});

describe("atomic writes", () => {
  it("writes via temp file + rename and keeps a one-step .bak", async () => {
    await readCollection("expenses");
    await expensesRepo.insert(expense({ id: "e1" }));
    await expensesRepo.insert(expense({ id: "e2" }));
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect((await readJson("expenses.json")).items.map((e: { id: string }) => e.id)).toEqual(["e1", "e2"]);
    expect((await readJson("expenses.json.bak")).items.map((e: { id: string }) => e.id)).toEqual(["e1"]);
  });

  it("does not write when the updater throws", async () => {
    await expensesRepo.insert(expense({ id: "keep" }));
    const before = await readFile(file("expenses.json"), "utf8");
    await expect(
      updateCollection("expenses", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await readFile(file("expenses.json"), "utf8")).toBe(before);
  });

  it("refuses to persist invalid data", async () => {
    await expect(
      writeCollection("expenses", [{ ...expense({ id: "bad" }), amountUah: 123456 }]),
    ).rejects.toThrow(/Refusing to write invalid data/);
    expect((await readdir(dir)).includes("expenses.json")).toBe(false);
  });
});

describe("serialization", () => {
  it("concurrent writes are serialized with no lost updates", async () => {
    await Promise.all(Array.from({ length: 40 }, (_, i) => expensesRepo.insert(expense({ id: `e${i}` }))));
    const items = await readCollection("expenses");
    expect(items).toHaveLength(40);
    expect(new Set(items.map((e) => e.id)).size).toBe(40);
  });

  it("withLock runs same-key tasks in FIFO order, other keys concurrently", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number) => async () => {
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end ${name}`);
    };
    await Promise.all([withLock("k", slow("a", 20)), withLock("k", slow("b", 1)), withLock("other", slow("c", 1))]);
    expect(order.indexOf("end a")).toBeLessThan(order.indexOf("start b"));
    expect(order.indexOf("start c")).toBeLessThan(order.indexOf("end a"));
  });
});

describe("corrupt files", () => {
  it("invalid JSON throws a clear DataFileError and the file is left untouched", async () => {
    await writeFile(file("expenses.json"), "{ not json");
    await expect(readCollection("expenses")).rejects.toBeInstanceOf(DataFileError);
    await expect(readCollection("expenses")).rejects.toThrow(/expenses\.json.*corrupt or invalid.*will not overwrite/s);
    await expect(expensesRepo.insert(expense())).rejects.toBeInstanceOf(DataFileError);
    expect(await readFile(file("expenses.json"), "utf8")).toBe("{ not json");
  });

  it("schema-invalid content throws (with the failing path) and is not overwritten", async () => {
    const bad = JSON.stringify({ version: 1, items: [{ id: "x", amount: -5 }] });
    await writeFile(file("expenses.json"), bad);
    await expect(readCollection("expenses")).rejects.toThrow(/items\.0/);
    await expect(readSnapshot()).rejects.toBeInstanceOf(DataFileError);
    expect(await readFile(file("expenses.json"), "utf8")).toBe(bad);
  });

  it("checkDataHealth lists problems instead of throwing", async () => {
    await writeFile(file("categories.json"), "[]");
    const problems = await checkDataHealth();
    expect(problems.map((p) => path.basename(p.file))).toEqual(["categories.json"]);
    expect(problems[0].message).toMatch(/categories\.json/);
  });

  it("a corrupt rates cache is moved aside (it is re-fetchable), never deleted", async () => {
    await writeFile(file("rates.json"), "garbage");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readRatesCache()).toEqual({ version: 1, USD: {}, EUR: {}, PLN: {}, meta: {} });
    const files = await readdir(dir);
    expect(files.some((f) => f.startsWith("rates.json.corrupt-"))).toBe(true);
    await updateRatesCache((c) => {
      c.USD["2026-10-15"] = { rate: 44.9801, fetchedAt: "2026-10-15T10:00:00.000Z" };
    });
    expect((await readRatesCache()).USD["2026-10-15"].rate).toBe(44.9801);
  });
});
