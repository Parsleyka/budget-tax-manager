import { describe, expect, it } from "vitest";
import { MIN_WAGE_SCHEDULE } from "@/lib/tax/rules";
import { TAX_CODE_URL, activeScheduleIndex, lawUrl, schedulePeriodLabel } from "./rule-sources";

describe("lawUrl", () => {
  it("maps convocations to zakon.rada.gov.ua suffixes", () => {
    expect(lawUrl("Law 4695-IX art. 8")).toBe("https://zakon.rada.gov.ua/laws/show/4695-20");
    expect(lawUrl("Law 2464-VI art. 4 ч. 6")).toBe("https://zakon.rada.gov.ua/laws/show/2464-17");
    expect(lawUrl("Law 3460-IX art. 8")).toBe("https://zakon.rada.gov.ua/laws/show/3460-20");
  });
  it("links Tax Code citations to 2755-17 and returns null otherwise", () => {
    expect(lawUrl("ПКУ п. 293.3 пп. 2")).toBe(TAX_CODE_URL);
    expect(lawUrl("ДПС ЗІР 107.05")).toBeNull();
  });
});

describe("МЗП schedule labels", () => {
  const froms = MIN_WAGE_SCHEDULE.map((e) => e.from);

  it("labels each period", () => {
    expect(froms.map((_, i) => schedulePeriodLabel(froms, i))).toEqual([
      "Jan – Mar 2024",
      "Apr – Dec 2024",
      "2025",
      "From Jan 2026",
    ]);
  });

  it("finds the row in force", () => {
    expect(activeScheduleIndex(froms, "2026-10")).toBe(3);
    expect(activeScheduleIndex(froms, "2024-03")).toBe(0);
    expect(activeScheduleIndex(froms, "2024-04")).toBe(1);
    expect(activeScheduleIndex(froms, "2023-12")).toBe(-1);
  });
});
