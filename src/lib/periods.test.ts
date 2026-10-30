import { describe, expect, it } from "vitest";
import {
  bucketKey,
  buckets,
  granularityFor,
  parsePeriodParams,
  previousPeriod,
  resolvePeriod,
  type PeriodPreset,
} from "./periods";

const today = "2026-10-15";

describe("resolvePeriod", () => {
  const cases: [PeriodPreset, { from: string; to: string }][] = [
    ["this-month", { from: "2026-10-01", to: "2026-10-15" }],
    ["last-month", { from: "2026-09-01", to: "2026-09-30" }],
    ["last-3-months", { from: "2026-08-01", to: "2026-10-15" }],
    ["last-6-months", { from: "2026-05-01", to: "2026-10-15" }],
    ["this-year", { from: "2026-01-01", to: "2026-10-15" }],
    ["last-year", { from: "2025-01-01", to: "2025-12-31" }],
  ];
  it.each(cases)("%s", (preset, expected) => {
    expect(resolvePeriod(preset, today)).toEqual(expected);
  });
  it("January boundaries", () => {
    expect(resolvePeriod("last-month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(resolvePeriod("last-3-months", "2026-01-10")).toEqual({ from: "2025-11-01", to: "2026-01-10" });
    expect(resolvePeriod("last-month", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("all", () => {
    expect(resolvePeriod("all", today)).toEqual({ from: today, to: today });
    expect(resolvePeriod("all", today, { dataRange: { from: "2024-03-01", to: "2026-09-01" } })).toEqual({
      from: "2024-03-01",
      to: today,
    });
    expect(resolvePeriod("all", today, { dataRange: { from: "2025-01-01", to: "2026-12-01" } })).toEqual({
      from: "2025-01-01",
      to: "2026-12-01",
    });
  });
  it("custom (swaps reversed, falls back when invalid)", () => {
    expect(resolvePeriod("custom", today, { custom: { from: "2026-02-01", to: "2026-02-10" } })).toEqual({
      from: "2026-02-01",
      to: "2026-02-10",
    });
    expect(resolvePeriod("custom", today, { custom: { from: "2026-02-10", to: "2026-02-01" } })).toEqual({
      from: "2026-02-01",
      to: "2026-02-10",
    });
    expect(resolvePeriod("custom", today, { custom: { from: "bad", to: "2026-02-01" } })).toEqual({
      from: "2026-10-01",
      to: today,
    });
  });
});

describe("previousPeriod", () => {
  it("this-month (MTD) → same days last month", () => {
    expect(previousPeriod({ from: "2026-10-01", to: "2026-10-15" }, "this-month")).toEqual({
      from: "2026-09-01",
      to: "2026-09-15",
    });
    // 31 March MTD → February clamps to 28th
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" }, "this-month")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });
  it("last-month → the month before (full month, month-end aware)", () => {
    expect(previousPeriod({ from: "2026-09-01", to: "2026-09-30" }, "last-month")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" }, "last-month")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });
  it("last-3-months / last-6-months shift by the months spanned", () => {
    expect(previousPeriod({ from: "2026-08-01", to: "2026-10-15" }, "last-3-months")).toEqual({
      from: "2026-05-01",
      to: "2026-07-15",
    });
    expect(previousPeriod({ from: "2026-05-01", to: "2026-10-15" }, "last-6-months")).toEqual({
      from: "2025-11-01",
      to: "2026-04-15",
    });
  });
  it("this-year / last-year → one year earlier", () => {
    expect(previousPeriod({ from: "2026-01-01", to: "2026-10-15" }, "this-year")).toEqual({
      from: "2025-01-01",
      to: "2025-10-15",
    });
    expect(previousPeriod({ from: "2025-01-01", to: "2025-12-31" }, "last-year")).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
    });
    // leap day
    expect(previousPeriod({ from: "2028-01-01", to: "2028-02-29" }, "this-year")).toEqual({
      from: "2027-01-01",
      to: "2027-02-28",
    });
  });
  it("custom → same length immediately before", () => {
    expect(previousPeriod({ from: "2026-10-05", to: "2026-10-14" }, "custom")).toEqual({
      from: "2026-09-25",
      to: "2026-10-04",
    });
  });
  it("all → null", () => {
    expect(previousPeriod({ from: "2024-01-01", to: today }, "all")).toBeNull();
  });
});

describe("granularity & buckets", () => {
  it("granularityFor", () => {
    expect(granularityFor({ from: "2026-10-01", to: "2026-10-31" })).toBe("day");
    expect(granularityFor({ from: "2026-08-01", to: "2026-10-15" })).toBe("week");
    expect(granularityFor({ from: "2026-01-01", to: "2026-10-15" })).toBe("month");
  });
  it("day buckets", () => {
    const b = buckets({ from: "2026-10-01", to: "2026-10-03" }, "day");
    expect(b.map((x) => x.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(b[0].label).toBe("1 Oct");
  });
  it("week buckets start on Monday and are clipped to the range", () => {
    const b = buckets({ from: "2026-10-01", to: "2026-10-15" }, "week");
    expect(b.map((x) => x.key)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(b[0].from).toBe("2026-10-01");
    expect(b[2].to).toBe("2026-10-15");
    expect(bucketKey("2026-10-04", "week")).toBe("2026-09-28");
  });
  it("month buckets", () => {
    const b = buckets({ from: "2026-08-10", to: "2026-10-15" }, "month");
    expect(b.map((x) => x.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(b[0].from).toBe("2026-08-10");
    expect(b[1]).toMatchObject({ from: "2026-09-01", to: "2026-09-30", label: "Sep 2026" });
  });
});

describe("parsePeriodParams", () => {
  it("defaults", () => {
    expect(parsePeriodParams({}, today)).toEqual({ preset: "this-month", range: { from: "2026-10-01", to: today } });
    expect(parsePeriodParams({}, today, { defaultPreset: "this-year" }).preset).toBe("this-year");
  });
  it("preset and custom", () => {
    expect(parsePeriodParams({ period: "last-month" }, today).range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(parsePeriodParams({ from: "2026-02-01", to: "2026-02-10" }, today)).toEqual({
      preset: "custom",
      range: { from: "2026-02-01", to: "2026-02-10" },
    });
    expect(parsePeriodParams({ period: "custom" }, today).preset).toBe("this-month");
    expect(parsePeriodParams({ period: ["last-year", "x"] }, today).preset).toBe("last-year");
    expect(parsePeriodParams({ period: "bogus" }, today).preset).toBe("this-month");
  });
});
