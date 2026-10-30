import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  addMonthsToDate,
  dateFromLocalDate,
  dayOfWeek,
  daysInMonth,
  diffDays,
  eachDay,
  formatDate,
  formatDateNumeric,
  formatDateRange,
  formatMonth,
  formatQuarter,
  fromNbuDate,
  isValidDate,
  isValidMonth,
  isValidQuarterKey,
  isWeekend,
  localDateFromDate,
  monthEnd,
  monthOf,
  monthsBetween,
  parseQuarterKey,
  quarterEnd,
  quarterKey,
  quarterKeyOf,
  quarterMonths,
  quarterOf,
  quarterStart,
  startOfWeek,
  toNbuDate,
  todayKyiv,
} from "./dates";

// Run under a time zone far from Kyiv to prove nothing depends on the machine TZ.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Los_Angeles";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe("todayKyiv — Europe/Kyiv calendar date regardless of machine TZ", () => {
  it("summer time (UTC+3) midnight boundary", () => {
    expect(todayKyiv(new Date("2026-10-14T20:59:59Z"))).toBe("2026-10-14");
    expect(todayKyiv(new Date("2026-10-14T21:00:00Z"))).toBe("2026-10-15");
    expect(todayKyiv(new Date("2026-10-15T13:00:00Z"))).toBe("2026-10-15");
  });
  it("winter time (UTC+2) and year boundary", () => {
    expect(todayKyiv(new Date("2026-12-31T21:59:59Z"))).toBe("2026-12-31");
    expect(todayKyiv(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });
  it("DST switch days", () => {
    // 29 Mar 2026: clocks go 03:00 → 04:00 (UTC+2 → UTC+3)
    expect(todayKyiv(new Date("2026-03-28T21:59:59Z"))).toBe("2026-03-28");
    expect(todayKyiv(new Date("2026-03-28T22:00:00Z"))).toBe("2026-03-29");
    // 25 Oct 2026: clocks go 04:00 → 03:00 (UTC+3 → UTC+2)
    expect(todayKyiv(new Date("2026-10-24T20:59:59Z"))).toBe("2026-10-24");
    expect(todayKyiv(new Date("2026-10-24T21:00:00Z"))).toBe("2026-10-25");
    expect(todayKyiv(new Date("2026-10-25T21:59:59Z"))).toBe("2026-10-25");
    expect(todayKyiv(new Date("2026-10-25T22:00:00Z"))).toBe("2026-10-26");
  });
});

describe("validation", () => {
  it("dates", () => {
    expect(isValidDate("2026-10-15")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2025-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-01")).toBe(false);
    expect(isValidDate("20261015")).toBe(false);
    expect(isValidDate(null)).toBe(false);
  });
  it("months / quarters", () => {
    expect(isValidMonth("2026-10")).toBe(true);
    expect(isValidMonth("2026-00")).toBe(false);
    expect(isValidQuarterKey("2026-Q4")).toBe(true);
    expect(isValidQuarterKey("2026-Q5")).toBe(false);
  });
});

describe("arithmetic is DST/TZ-safe", () => {
  it("addDays across DST and year ends", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDays("2025-12-31", 40)).toBe("2026-02-09");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("diffDays / eachDay", () => {
    expect(diffDays("2026-10-01", "2026-10-15")).toBe(14);
    expect(diffDays("2026-03-28", "2026-03-30")).toBe(2);
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
  it("weekdays", () => {
    expect(dayOfWeek("2026-10-15")).toBe(4); // Thursday
    expect(isWeekend("2026-10-17")).toBe(true);
    expect(isWeekend("2026-10-19")).toBe(false);
    expect(startOfWeek("2026-10-15")).toBe("2026-10-12");
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12"); // Sunday → previous Monday
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
  });
});

describe("months & quarters", () => {
  it("month helpers", () => {
    expect(monthOf("2026-10-15")).toBe("2026-10");
    expect(monthEnd("2024-02")).toBe("2024-02-29");
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
    expect(addMonthsToDate("2026-03-31", -1)).toBe("2026-02-28");
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("quarter math", () => {
    expect(quarterOf("2026-01-01")).toBe(1);
    expect(quarterOf("2026-03-31")).toBe(1);
    expect(quarterOf("2026-04-01")).toBe(2);
    expect(quarterOf("2026-09")).toBe(3);
    expect(quarterOf("2026-12-31")).toBe(4);
    expect(quarterKey(2026, 4)).toBe("2026-Q4");
    expect(quarterKeyOf("2026-10-15")).toBe("2026-Q4");
    expect(parseQuarterKey("2025-Q2")).toEqual({ year: 2025, quarter: 2 });
    expect(quarterMonths(2026, 2)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(quarterStart(2026, 3)).toBe("2026-07-01");
    expect(quarterEnd(2026, 1)).toBe("2026-03-31");
    expect(quarterEnd(2026, 2)).toBe("2026-06-30");
    expect(quarterEnd(2026, 3)).toBe("2026-09-30");
    expect(quarterEnd(2026, 4)).toBe("2026-12-31");
  });
});

describe("NBU bridges & display", () => {
  it("toNbuDate / fromNbuDate", () => {
    expect(toNbuDate("2026-10-09")).toBe("20261009");
    expect(fromNbuDate("09.10.2026")).toBe("2026-10-09");
    expect(fromNbuDate("31.02.2026")).toBeNull();
    expect(() => toNbuDate("2026-10-9")).toThrow();
  });
  it("formatting", () => {
    expect(formatDate("2026-10-15")).toBe("15 Oct 2026");
    expect(formatDateNumeric("2026-10-05")).toBe("05.10.2026");
    expect(formatMonth("2026-10")).toBe("Oct 2026");
    expect(formatMonth("2026-10", true)).toBe("October 2026");
    expect(formatQuarter("2026-Q3")).toBe("Q3 2026");
    expect(formatDateRange("2026-10-01", "2026-10-15")).toBe("1–15 Oct 2026");
    expect(formatDateRange("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Oct 2026");
    expect(formatDateRange("2025-12-01", "2026-01-15")).toBe("1 Dec 2025 – 15 Jan 2026");
  });
  it("calendar Date bridges use local parts (react-day-picker)", () => {
    expect(dateFromLocalDate(new Date(2026, 9, 15))).toBe("2026-10-15");
    expect(dateFromLocalDate(localDateFromDate("2026-03-29"))).toBe("2026-03-29");
  });
});
