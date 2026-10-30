import { describe, expect, it } from "vitest";
import { dayOfWeek, type Quarter } from "../dates";
import {
  deadlinesForYear,
  esvDeadline,
  filingDeadline,
  fortiethDay,
  nextBusinessDay,
  paymentDeadline,
  quarterDeadlines,
  upcomingDeadlines,
} from "./deadlines";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** research/tax-rules.md §3.2 — single tax + military levy. */
const filingAndPayment: { year: number; q: Quarter; fortieth: string; fortiethDow: string; file: string; fileDow: string; pay: string; payDow: string }[] = [
  { year: 2025, q: 4, fortieth: "2026-02-09", fortiethDow: "Mon", file: "2026-02-09", fileDow: "Mon", pay: "2026-02-19", payDow: "Thu" },
  { year: 2026, q: 1, fortieth: "2026-05-10", fortiethDow: "Sun", file: "2026-05-11", fileDow: "Mon", pay: "2026-05-20", payDow: "Wed" },
  { year: 2026, q: 2, fortieth: "2026-08-09", fortiethDow: "Sun", file: "2026-08-10", fileDow: "Mon", pay: "2026-08-19", payDow: "Wed" },
  { year: 2026, q: 3, fortieth: "2026-11-09", fortiethDow: "Mon", file: "2026-11-09", fileDow: "Mon", pay: "2026-11-19", payDow: "Thu" },
  { year: 2026, q: 4, fortieth: "2027-02-09", fortiethDow: "Tue", file: "2027-02-09", fileDow: "Tue", pay: "2027-02-19", payDow: "Fri" },
];

/** research/tax-rules.md §3.3 — own ЄСВ. */
const esv: { year: number; q: Quarter; date: string; dow: string }[] = [
  { year: 2025, q: 4, date: "2026-01-19", dow: "Mon" },
  { year: 2026, q: 1, date: "2026-04-20", dow: "Mon" }, // 19.04 is a Sunday
  { year: 2026, q: 2, date: "2026-07-20", dow: "Mon" }, // 19.07 is a Sunday
  { year: 2026, q: 3, date: "2026-10-19", dow: "Mon" },
  { year: 2026, q: 4, date: "2027-01-19", dow: "Tue" },
];

describe("§3.2 filing + payment deadlines", () => {
  it.each(filingAndPayment)("Q$q $year", (row) => {
    expect(fortiethDay(row.year, row.q)).toBe(row.fortieth);
    expect(DOW[dayOfWeek(row.fortieth)]).toBe(row.fortiethDow);
    expect(filingDeadline(row.year, row.q)).toBe(row.file);
    expect(DOW[dayOfWeek(row.file)]).toBe(row.fileDow);
    expect(paymentDeadline(row.year, row.q)).toBe(row.pay);
    expect(DOW[dayOfWeek(row.pay)]).toBe(row.payDow);
  });
  it("payment counts 10 days from the UNSHIFTED 40th day (Q2 2026 → 19.08, not 20.08)", () => {
    expect(paymentDeadline(2026, 2)).toBe("2026-08-19");
    expect(paymentDeadline(2026, 1)).toBe("2026-05-20");
  });
});

describe("§3.3 ЄСВ deadlines", () => {
  it.each(esv)("Q$q $year", (row) => {
    expect(esvDeadline(row.year, row.q)).toBe(row.date);
    expect(DOW[dayOfWeek(row.date)]).toBe(row.dow);
  });
});

describe("business days", () => {
  it("nextBusinessDay with and without holidays", () => {
    expect(nextBusinessDay("2026-10-17")).toBe("2026-10-19");
    expect(nextBusinessDay("2026-10-19")).toBe("2026-10-19");
    expect(nextBusinessDay("2026-10-19", ["2026-10-19"])).toBe("2026-10-20");
    // holidays list shifts a filing deadline
    expect(filingDeadline(2026, 3, ["2026-11-09"])).toBe("2026-11-10");
  });
  it("quarterDeadlines bundles all three", () => {
    expect(quarterDeadlines(2026, 3)).toEqual({
      period: "2026-Q3",
      fortiethDay: "2026-11-09",
      filing: "2026-11-09",
      payment: "2026-11-19",
      esv: "2026-10-19",
    });
  });
});

describe("lists", () => {
  it("deadlinesForYear has 12 entries, sorted", () => {
    const list = deadlinesForYear(2026);
    expect(list).toHaveLength(12);
    expect(list[0]).toMatchObject({ kind: "esv", period: "2026-Q1", date: "2026-04-20" });
    expect(list.at(-1)).toMatchObject({ kind: "payment", period: "2026-Q4", date: "2027-02-19" });
    expect(list.find((d) => d.kind === "filing" && d.quarter === 4)?.label).toContain("annual");
  });
  it("upcomingDeadlines from 2026-10-15", () => {
    const up = upcomingDeadlines("2026-10-15", { count: 4 });
    expect(up.map((d) => [d.kind, d.period, d.date, d.daysLeft])).toEqual([
      ["esv", "2026-Q3", "2026-10-19", 4],
      ["filing", "2026-Q3", "2026-11-09", 25],
      ["payment", "2026-Q3", "2026-11-19", 35],
      ["esv", "2026-Q4", "2027-01-19", 96],
    ]);
  });
});
