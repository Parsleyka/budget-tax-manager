import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNbuMock, dayBody, WRONG_DATE_BODY } from "@/test/nbu-mock";
import { readRatesCache, updateRatesCache } from "../db/store";
import { fetchNbuDay, fetchNbuRange, NbuError, nbuDayUrl, parseNbuDayBody, parseNbuRangeBody } from "./client";
import {
  backfillRates,
  getExactRate,
  getHeaderRates,
  getRate,
  getRatesForDates,
  InvalidRateRequestError,
  isNbuOffline,
  RateUnavailableError,
  RENDER_FETCH,
  resetNbuMemory,
} from "./rates";

const TODAY = "2026-10-15";
const FAST = { fetch: { timeoutMs: 30, retryDelayMs: 0 }, today: TODAY };

// Real values observed in research/nbu-api.md.
const USD = {
  "2026-10-09": 44.8526,
  "2026-10-10": 44.8526,
  "2026-10-11": 44.8526,
  "2026-10-12": 44.8894,
  "2026-10-14": 44.95,
  "2026-10-15": 44.9801,
  "2026-10-16": 44.8871,
};
const EUR = { "2026-10-14": 52.1, "2026-10-15": 52.2, "2026-10-16": 50.3081 };

let dir: string;
let nbu: ReturnType<typeof createNbuMock>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "budget-nbu-test-"));
  process.env.BUDGET_DATA_DIR = dir;
  resetNbuMemory();
  nbu = createNbuMock({ USD, EUR });
  vi.stubGlobal("fetch", nbu.fetch);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.BUDGET_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("client parsing", () => {
  it("parses a row (CRLF body, DD.MM.YYYY date)", () => {
    expect(parseNbuDayBody(dayBody("USD", "2026-10-11", 44.8526), "USD")).toEqual({ currency: "USD", date: "2026-10-11", rate: 44.8526 });
  });
  it("[] → null", () => {
    expect(parseNbuDayBody("[]", "USD")).toBeNull();
    expect(parseNbuDayBody("[\r\n]", "USD")).toBeNull();
  });
  it('non-JSON "Wrong date format" body → NbuError(bad-response)', () => {
    expect(() => parseNbuDayBody(WRONG_DATE_BODY, "USD")).toThrow(NbuError);
    try {
      parseNbuDayBody(WRONG_DATE_BODY, "USD");
    } catch (e) {
      expect((e as NbuError).kind).toBe("bad-response");
      expect((e as NbuError).message).toMatch(/Wrong date format/);
    }
    expect(() => parseNbuDayBody("<html>", "USD")).toThrow(NbuError);
  });
  it("range parsing uses rate_per_unit, not rate", () => {
    const body =
      '[{"exchangedate":"09.10.2026","r030":840,"cc":"USD","rate":448.526,"units":10,"rate_per_unit":44.8526,"calcdate":"08.10.2026"}]';
    expect(parseNbuRangeBody(body, "USD")).toEqual([{ date: "2026-10-09", rate: 44.8526, calcdate: "2026-10-08" }]);
  });
  it("always sends an explicit date", () => {
    expect(nbuDayUrl("USD", "2026-10-09")).toBe(
      "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&date=20261009&json",
    );
  });
});

describe("client HTTP behaviour", () => {
  it("fetches one row", async () => {
    expect(await fetchNbuDay("USD", "2026-10-09")).toEqual({ currency: "USD", date: "2026-10-09", rate: 44.8526 });
  });
  it("[] for unpublished dates", async () => {
    expect(await fetchNbuDay("USD", "2026-10-17")).toBeNull();
  });
  it("retries once on a bad body, then throws", async () => {
    nbu.when((u) => u.searchParams.get("date") === "20261009", WRONG_DATE_BODY);
    await expect(fetchNbuDay("USD", "2026-10-09", { retryDelayMs: 0 })).rejects.toMatchObject({ kind: "bad-response" });
    expect(nbu.fetch).toHaveBeenCalledTimes(2);
  });
  it("times out", async () => {
    nbu.when(() => true, "hang");
    await expect(fetchNbuDay("USD", "2026-10-09", { timeoutMs: 20, retryDelayMs: 0 })).rejects.toMatchObject({ kind: "timeout" });
    expect(nbu.fetch).toHaveBeenCalledTimes(2);
  });
  it("network errors", async () => {
    nbu.when(() => true, new TypeError("fetch failed"));
    await expect(fetchNbuDay("USD", "2026-10-09", { retries: 0 })).rejects.toMatchObject({ kind: "network" });
  });
  it("rejects bad input before calling NBU", async () => {
    await expect(fetchNbuDay("USD", "2026-02-30")).rejects.toThrow(RangeError);
    // @ts-expect-error — not whitelisted
    await expect(fetchNbuDay("JPY", "2026-10-09")).rejects.toThrow(RangeError);
    expect(nbu.fetch).not.toHaveBeenCalled();
  });
  it("range endpoint", async () => {
    const rows = await fetchNbuRange("USD", "2026-10-09", "2026-10-12");
    expect(rows.map((r) => [r.date, r.rate])).toEqual([
      ["2026-10-09", 44.8526],
      ["2026-10-10", 44.8526],
      ["2026-10-11", 44.8526],
      ["2026-10-12", 44.8894],
    ]);
  });
});

describe("getRate", () => {
  it("UAH is always 1 and never fetched", async () => {
    expect(await getRate("UAH", "2026-10-09")).toEqual({
      currency: "UAH",
      date: "2026-10-09",
      rate: 1,
      effectiveDate: "2026-10-09",
      source: "fixed",
      stale: false,
    });
    expect(nbu.fetch).not.toHaveBeenCalled();
  });
  it("validates currency (whitelist) and date", async () => {
    // @ts-expect-error — not whitelisted
    await expect(getRate("GBP", "2026-10-09")).rejects.toBeInstanceOf(InvalidRateRequestError);
    await expect(getRate("USD", "2026-13-01")).rejects.toBeInstanceOf(InvalidRateRequestError);
  });
  it("fetches, caches permanently, then serves from cache", async () => {
    const first = await getRate("USD", "2026-10-09", FAST);
    expect(first).toMatchObject({ rate: 44.8526, source: "nbu", stale: false, effectiveDate: "2026-10-09" });
    const cache = JSON.parse(await readFile(path.join(dir, "rates.json"), "utf8"));
    expect(cache.USD["2026-10-09"].rate).toBe(44.8526);
    const second = await getRate("USD", "2026-10-09", FAST);
    expect(second).toMatchObject({ rate: 44.8526, source: "cache", stale: false });
    expect(nbu.fetch).toHaveBeenCalledTimes(1);
  });
  it("weekend dates have their own rows (Sat/Sun = Friday's rate)", async () => {
    expect((await getRate("USD", "2026-10-11", FAST)).rate).toBe(44.8526);
  });
  it("[] is never cached permanently; short in-memory negative cache; stale fallback", async () => {
    await getRate("USD", "2026-10-16", FAST); // cache tomorrow (already published)
    const sat = await getRate("USD", "2026-10-17", FAST); // not published yet → []
    expect(sat).toMatchObject({ rate: 44.8871, effectiveDate: "2026-10-16", source: "cache", stale: true });
    const cache = await readRatesCache();
    expect(cache.USD["2026-10-17"]).toBeUndefined();
    const callsBefore = nbu.fetch.mock.calls.length;
    await getRate("USD", "2026-10-17", FAST);
    expect(nbu.fetch.mock.calls.length).toBe(callsBefore); // negative-cached in memory
    resetNbuMemory(); // "15 minutes later"
    await getRate("USD", "2026-10-17", FAST);
    expect(nbu.fetch.mock.calls.length).toBeGreaterThan(callsBefore);
  });
  it("[] with an empty cache refreshes via a short range backfill", async () => {
    // a far-future date: [] → backfill [today−14, today] → newest ≤ date
    const r = await getRate("USD", "2026-12-31", FAST);
    expect(r).toMatchObject({ rate: 44.9801, effectiveDate: TODAY, stale: true });
    expect(nbu.calls().some((u) => u.includes("exchange_site"))).toBe(true);
  });
  it("timeout → stale fallback to the newest cached rate, NBU marked offline", async () => {
    await updateRatesCache((c) => {
      c.USD["2026-10-14"] = { rate: 44.95, fetchedAt: "2026-10-14T12:00:00.000Z" };
    });
    nbu.when(() => true, "hang");
    const r = await getRate("USD", TODAY, FAST);
    expect(r).toMatchObject({ rate: 44.95, effectiveDate: "2026-10-14", source: "cache", stale: true });
    const calls = nbu.fetch.mock.calls.length;
    const again = await getRate("USD", TODAY, FAST); // offline for 60 s → no new request
    expect(again.stale).toBe(true);
    expect(nbu.fetch.mock.calls.length).toBe(calls);
  });
  it("unavailable and nothing cached → RateUnavailableError", async () => {
    nbu.when(() => true, new TypeError("offline"));
    await expect(getRate("EUR", TODAY, FAST)).rejects.toBeInstanceOf(RateUnavailableError);
  });
  it('"Wrong date format" body is treated as an error (fallback), not as data', async () => {
    await updateRatesCache((c) => {
      c.USD["2026-10-12"] = { rate: 44.8894, fetchedAt: "2026-10-12T12:00:00.000Z" };
    });
    nbu.when((u) => u.pathname.endsWith("/exchange"), WRONG_DATE_BODY);
    const r = await getRate("USD", "2026-10-14", FAST);
    expect(r).toMatchObject({ rate: 44.8894, stale: true });
  });
});

describe("backfill & batch lookups", () => {
  it("range backfill stores rate_per_unit for every calendar day", async () => {
    nbu.when(
      (u) => u.pathname.endsWith("/exchange_site"),
      '[{"exchangedate":"09.10.2026","cc":"USD","rate":448.526,"units":10,"rate_per_unit":44.8526,"calcdate":"08.10.2026"},' +
        '{"exchangedate":"10.10.2026","cc":"USD","rate":448.526,"units":10,"rate_per_unit":44.8526,"calcdate":"08.10.2026"}]',
    );
    expect(await backfillRates("USD", "2026-10-09", "2026-10-10", FAST)).toBe(2);
    const cache = await readRatesCache();
    expect(cache.USD["2026-10-09"]).toMatchObject({ rate: 44.8526, calcdate: "2026-10-08" });
    expect(cache.USD["2026-10-10"].rate).toBe(44.8526);
    expect(cache.meta.lastBackfillAt).toBeDefined();
  });
  it("getRatesForDates does one range call for missing past dates", async () => {
    const m = await getRatesForDates("USD", ["2026-10-09", "2026-10-12", "2026-10-09"], FAST);
    expect(m.get("2026-10-09")?.rate).toBe(44.8526);
    expect(m.get("2026-10-12")?.rate).toBe(44.8894);
    expect(nbu.calls().filter((u) => u.includes("exchange_site"))).toHaveLength(1);
    expect(nbu.calls().filter((u) => u.includes("/exchange?"))).toHaveLength(0);
  });
  it("getExactRate returns null for unpublished dates (no fallback)", async () => {
    expect(await getExactRate("USD", "2026-10-17", FAST)).toBeNull();
    expect(await getExactRate("USD", "2026-10-16", FAST)).toMatchObject({ rate: 44.8871 });
  });
});

describe("header rates", () => {
  it("today + change vs previous day + tomorrow when published", async () => {
    const h = await getHeaderRates(TODAY, FAST);
    expect(h.today).toBe(TODAY);
    expect(h.offline).toBe(false);
    expect(h.USD).toMatchObject({
      rate: 44.9801,
      stale: false,
      previous: { date: "2026-10-14", rate: 44.95 },
      change: 0.0301,
      tomorrow: { date: "2026-10-16", rate: 44.8871 },
    });
    expect(h.USD?.changePct).toBeCloseTo(0.0301 / 44.95, 10);
    expect(h.EUR).toMatchObject({ rate: 52.2, change: 0.1, tomorrow: { date: "2026-10-16", rate: 50.3081 } });
  });
  it("never throws when NBU is down and nothing is cached", async () => {
    nbu.when(() => true, new TypeError("offline"));
    const h = await getHeaderRates(TODAY, FAST);
    expect(h).toMatchObject({ USD: null, EUR: null, offline: true });
  });
});

describe("DATA-02 / JOURNEY-3 / REACT-5: a hanging NBU never blocks a render for long", () => {
  it("today + yesterday cached, tomorrow's probe hangs → one short probe, then instant while offline", async () => {
    await updateRatesCache((c) => {
      for (const cur of ["USD", "EUR", "PLN"] as const) {
        c[cur]["2026-10-14"] = { rate: 44, fetchedAt: "2026-10-14T12:00:00.000Z" };
        c[cur][TODAY] = { rate: 45, fetchedAt: "2026-10-14T12:00:00.000Z" };
      }
    });
    nbu.when(() => true, "hang");
    const t0 = Date.now();
    const h = await getHeaderRates(TODAY, { fetch: RENDER_FETCH, today: TODAY });
    const first = Date.now() - t0;
    expect(first).toBeLessThan(2500); // was ≈10.3 s (5 s timeout + retry)
    expect(h.USD).toMatchObject({ rate: 45, stale: false, tomorrow: null, change: 1 });
    expect(h.offline).toBe(true);
    const t1 = Date.now();
    await getHeaderRates(TODAY, { fetch: RENDER_FETCH, today: TODAY });
    expect(Date.now() - t1).toBeLessThan(200);
  });
  it("concurrent lookups of the same date share one request", async () => {
    const slow = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return new Response(dayBody("USD", "2026-10-12", 44.8894), { status: 200 });
    });
    vi.stubGlobal("fetch", slow);
    const opts = { fetch: { timeoutMs: 1000, retries: 0 }, today: TODAY };
    const [a, b] = await Promise.all([getRate("USD", "2026-10-12", opts), getRate("USD", "2026-10-12", opts)]);
    expect(a.rate).toBe(44.8894);
    expect(b.rate).toBe(44.8894);
    expect(slow).toHaveBeenCalledTimes(1);
  });
  it("the offline window backs off on repeated failures and resets after a success", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-15T09:00:00Z") });
    try {
      nbu.when((u) => u.searchParams.get("date") !== "20261012", new TypeError("offline"));
      expect(await getExactRate("USD", "2026-10-13", FAST)).toBeNull();
      expect(isNbuOffline()).toBe(true);
      vi.setSystemTime(Date.now() + 61_000);
      expect(isNbuOffline()).toBe(false);
      expect(await getExactRate("USD", "2026-10-13", FAST)).toBeNull(); // 2nd failure in a row → 120 s
      vi.setSystemTime(Date.now() + 61_000);
      expect(isNbuOffline()).toBe(true);
      vi.setSystemTime(Date.now() + 60_000);
      expect(isNbuOffline()).toBe(false);
      expect(await getExactRate("USD", "2026-10-12", FAST)).toMatchObject({ rate: 44.8894 }); // success resets
      expect(await getExactRate("USD", "2026-10-13", FAST)).toBeNull();
      vi.setSystemTime(Date.now() + 61_000);
      expect(isNbuOffline()).toBe(false); // back to 60 s
    } finally {
      vi.useRealTimers();
    }
  });
  it("getRatesForDates resolves cached dates from a single cache read", async () => {
    await updateRatesCache((c) => {
      c.USD["2026-10-09"] = { rate: 44.8526, fetchedAt: "2026-10-09T12:00:00.000Z" };
      c.USD["2026-10-12"] = { rate: 44.8894, fetchedAt: "2026-10-12T12:00:00.000Z" };
    });
    const m = await getRatesForDates("USD", ["2026-10-09", "2026-10-12"], FAST);
    expect(m.get("2026-10-12")).toMatchObject({ rate: 44.8894, source: "cache", stale: false });
    expect(nbu.fetch).not.toHaveBeenCalled();
  });
});
