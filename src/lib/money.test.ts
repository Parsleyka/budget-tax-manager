import { describe, expect, it } from "vitest";
import {
  addMoney,
  apportion,
  convertMinorToUah,
  convertToUah,
  divRoundHalfUp,
  effectiveRate,
  formatMoney,
  formatPercent,
  formatRate,
  fromMinor,
  hasAtMostDecimals,
  parseMoneyInput,
  parseRateInput,
  pctToBp,
  percentOf,
  percentOfMinor,
  percentUnits,
  rateToScaled,
  ratio,
  round2,
  roundedShares,
  round4,
  subtractMoney,
  sumMoney,
  toMinor,
} from "./money";

/** Intl uses U+00A0 / U+202F; normalize to plain spaces for readable assertions. */
const n = (s: string) => s.replace(/[  ]/g, " ");

describe("toMinor / fromMinor", () => {
  it("converts exactly", () => {
    expect(toMinor(1234.56)).toBe(123456);
    expect(toMinor(0.1)).toBe(10);
    expect(toMinor(0.29)).toBe(29); // 0.29*100 = 28.999999999999996 in floats
    expect(toMinor(1.15)).toBe(115);
    expect(toMinor(-12.34)).toBe(-1234);
    expect(toMinor(0)).toBe(0);
    expect(fromMinor(123456)).toBe(1234.56);
    expect(fromMinor(-1)).toBe(-0.01);
    expect(Object.is(fromMinor(-0), 0)).toBe(true);
  });
  it("rejects more than 2 decimals / non-finite", () => {
    expect(() => toMinor(1.005)).toThrow(RangeError);
    expect(() => toMinor(0.1 + 0.2)).toThrow(RangeError);
    expect(() => toMinor(Number.NaN)).toThrow(RangeError);
    expect(() => toMinor(Infinity)).toThrow(RangeError);
    expect(() => fromMinor(1.5)).toThrow(RangeError);
  });
  it("hasAtMostDecimals", () => {
    expect(hasAtMostDecimals(44.9801, 4)).toBe(true);
    expect(hasAtMostDecimals(44.98015, 4)).toBe(false);
    expect(hasAtMostDecimals(10, 0)).toBe(true);
    expect(hasAtMostDecimals(9_999_999_999.99, 2)).toBe(true);
  });
});

describe("sums without float drift", () => {
  it("sumMoney", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(Array.from({ length: 10 }, () => 0.1))).toBe(1);
    expect(sumMoney([1234.56, -234.56, 0.01])).toBe(1000.01);
    expect(sumMoney([])).toBe(0);
  });
  it("add / subtract", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(subtractMoney(0.3, 0.1)).toBe(0.2);
  });
});

describe("divRoundHalfUp", () => {
  it("rounds half away from zero", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(14n, 10n)).toBe(1n);
    expect(divRoundHalfUp(15n, 10n)).toBe(2n);
    expect(divRoundHalfUp(-15n, 10n)).toBe(-2n);
    expect(divRoundHalfUp(-14n, 10n)).toBe(-1n);
    expect(divRoundHalfUp(15n, -10n)).toBe(-2n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow();
  });
});

describe("convertToUah", () => {
  it("1234.56 × 44.9801 = 55 530.63 (exact integer math)", () => {
    // 123456 × 449801 = 55 530 632 256 → / 1e4 = 5 553 063.2256 → 5 553 063 kopecks
    expect(convertMinorToUah(123456, 44.9801)).toBe(5_553_063);
    expect(convertToUah(1234.56, 44.9801)).toBe(55530.63);
  });
  it("half-up at exactly .5 kopeck", () => {
    // 0.01 × 0.5 = 0.005 → 0.01
    expect(convertToUah(0.01, 0.5)).toBe(0.01);
    // 1.00 × 41.2345 = 41.2345 → 41.23 ; 1.00 × 41.2355 = 41.2355 → 41.24
    expect(convertToUah(1, 41.2345)).toBe(41.23);
    expect(convertToUah(1, 41.2355)).toBe(41.24);
    // 0.50 × 0.0001 = 0.00005 → 0.00 (below half a kopeck)
    expect(convertToUah(0.5, 0.0001)).toBe(0);
  });
  it("negatives round symmetric (away from zero)", () => {
    expect(convertToUah(-0.01, 0.5)).toBe(-0.01);
    expect(convertToUah(-1234.56, 44.9801)).toBe(-55530.63);
    expect(convertToUah(-1, 41.2355)).toBe(-41.24);
  });
  it("NBU-style amounts", () => {
    expect(convertToUah(1000, 44.8526)).toBe(44852.6);
    expect(convertToUah(2500, 50.3081)).toBe(125770.25);
    expect(convertToUah(1, 1)).toBe(1);
  });
  it("is exact for large amounts (no 2^53 overflow)", () => {
    // 9 999 999 999.99 × 99.9999 — intermediate exceeds 2^53, bigint keeps it exact
    expect(convertToUah(9_999_999_999.99, 99.9999)).toBe(999_998_999_999.0);
  });
  it("rejects rates with more than 4 decimals", () => {
    expect(() => convertToUah(1, 44.98011)).toThrow(RangeError);
    expect(rateToScaled(44.9801)).toBe(449801);
    expect(rateToScaled(28.431)).toBe(284310);
  });
});

describe("percentOf (basis points, HALF-UP)", () => {
  it("tax rates", () => {
    expect(percentOf(8000, 2200)).toBe(1760); // min ЄСВ 2025
    expect(percentOf(8647, 2200)).toBe(1902.34); // min ЄСВ 2026
    expect(percentOf(7100, 2200)).toBe(1562);
    expect(percentOf(100000, 500)).toBe(5000);
    expect(percentOf(100000, 100)).toBe(1000);
    expect(percentOf(100000, 1500)).toBe(15000);
  });
  it("half-up at the half kopeck, symmetric for negatives", () => {
    expect(percentOf(0.1, 500)).toBe(0.01); // 0.005 → 0.01
    expect(percentOf(0.09, 500)).toBe(0); // 0.0045 → 0.00
    expect(percentOf(-0.1, 500)).toBe(-0.01);
    expect(percentOfMinor(-10, 500)).toBe(-1);
    expect(percentOf(12345.67, 500)).toBe(617.28); // 617.2835
  });
  it("pctToBp", () => {
    expect(pctToBp(5)).toBe(500);
    expect(pctToBp(1.5)).toBe(150);
    expect(pctToBp(22)).toBe(2200);
    expect(() => pctToBp(1.234)).toThrow(RangeError);
  });
});

describe("rates & ratios", () => {
  it("effectiveRate", () => {
    expect(effectiveRate(1000, 44850)).toBe(44.85);
    expect(effectiveRate(3, 100)).toBe(33.3333);
    expect(effectiveRate(3, 200)).toBe(66.6667);
    expect(() => effectiveRate(0, 1)).toThrow();
  });
  it("ratio", () => {
    expect(ratio(50, 200)).toBe(0.25);
    expect(ratio(1, 0)).toBeNull();
  });
  it("round2 / round4", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round4(44.98015)).toBe(44.9802);
  });
});

describe("LEDGER-4: display shares add up to exactly 100 %", () => {
  /** What a "Share" column shows, and the sum of what it shows in tenths of a percent. */
  const shown = (shares: number[]) => shares.map((s) => formatPercent(s));
  const shownTenths = (shares: number[]) => shown(shares).reduce((sum, t) => sum + Math.round(Number(t.replace(/[^\d,]/g, "").replace(",", ".")) * 10), 0);

  it("the reported Frozen split (24,7 + 23,9 + 51,2 + 0,1 = 99,9 %) now adds up to 100,0 %", () => {
    const amounts = [2473.78, 2393.43, 5121.39, 11.4]; // exact shares 24,7378 / 23,9343 / 51,2139 / 0,1140 %
    const naive = amounts.map((a) => a / sumMoney(amounts));
    expect(shownTenths(naive)).toBe(999); // the bug: rounding each share on its own
    const shares = roundedShares(amounts);
    expect(shownTenths(shares)).toBe(1000);
    expect(shown(shares).map(n)).toEqual(["24,8%", "23,9%", "51,2%", "0,1%"]);
  });

  it("never shows 100,1 % either; ties go to the larger amount, then the earlier entry", () => {
    const amounts = [33.35, 33.35, 33.3];
    expect(shownTenths(amounts.map((a) => a / 100))).toBe(1001);
    expect(shown(roundedShares(amounts)).map(n)).toEqual(["33,4%", "33,3%", "33,3%"]);
    expect(shown(roundedShares([1, 1, 1])).map(n)).toEqual(["33,4%", "33,3%", "33,3%"]);
    expect(shown(roundedShares([1, 2, 2])).map(n)).toEqual(["20,0%", "40,0%", "40,0%"]);
  });

  it("ignores amounts ≤ 0 and returns zeros when nothing is positive", () => {
    expect(roundedShares([50, -20, 0, 50])).toEqual([0.5, 0, 0, 0.5]);
    expect(roundedShares([0, -1])).toEqual([0, 0]);
    expect(roundedShares([])).toEqual([]);
  });

  it("apportion hands out exactly the given units (any precision)", () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(apportion([247, 0, 500], 7)).toEqual([2, 0, 5]);
    expect(apportion([5, 5], 0)).toEqual([0, 0]);
    expect(percentUnits(0)).toBe(100);
    expect(percentUnits(2)).toBe(10_000);
    expect(roundedShares([1, 1, 1], 2).reduce((s, x) => s + Math.round(x * 10_000), 0)).toBe(10_000);
    expect(() => apportion([1.5], 10)).toThrow();
    expect(() => apportion([1], -1)).toThrow();
  });

  it("sums to 100 % for many random splits", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 200; k++) {
      const amounts = Array.from({ length: 1 + (k % 14) }, () => Math.round(rnd() * 1_000_000) / 100);
      if (amounts.every((a) => a <= 0)) continue;
      expect(shownTenths(roundedShares(amounts))).toBe(1000);
    }
  });
});

describe("parsing user input", () => {
  it("parseMoneyInput", () => {
    expect(parseMoneyInput("1 234,56")).toBe(1234.56);
    expect(parseMoneyInput("1 234,56")).toBe(1234.56);
    expect(parseMoneyInput("1,234.56")).toBe(1234.56);
    expect(parseMoneyInput("1.234,56")).toBe(1234.56);
    expect(parseMoneyInput("1234.5")).toBe(1234.5);
    expect(parseMoneyInput("-12,3")).toBe(-12.3);
    expect(parseMoneyInput("12.345")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("")).toBeNull();
  });
  it("JOURNEY-4: a single separator followed by 3 digits is a thousands separator → refused, never 1000× smaller", () => {
    expect(parseMoneyInput("58.500")).toBeNull();
    expect(parseMoneyInput("58,500")).toBeNull();
    expect(parseMoneyInput("58.520")).toBeNull();
    expect(parseMoneyInput("15,000")).toBeNull();
    expect(parseMoneyInput("58.500,00")).toBe(58500);
    expect(parseMoneyInput("58,500.00")).toBe(58500);
    expect(parseMoneyInput("58 500")).toBe(58500);
    expect(parseMoneyInput("58,50")).toBe(58.5);
    expect(parseMoneyInput("58.5")).toBe(58.5);
  });
  it("parseRateInput", () => {
    expect(parseRateInput("44,9801")).toBe(44.9801);
    expect(parseRateInput("44.98011")).toBeNull();
    expect(parseRateInput("0")).toBeNull();
  });
});

describe("formatting (uk-UA, narrow symbols)", () => {
  it("formatMoney", () => {
    expect(n(formatMoney(41230.5, "UAH"))).toBe("41 230,50 ₴");
    expect(n(formatMoney(1000, "USD"))).toBe("1 000,00 $");
    expect(n(formatMoney(950, "EUR"))).toBe("950,00 €");
    expect(n(formatMoney(-12.3, "UAH"))).toBe("-12,30 ₴");
    expect(n(formatMoney(12.3, "UAH", { signDisplay: "exceptZero" }))).toBe("+12,30 ₴");
    expect(n(formatMoney(41230.5, "UAH", { noDecimals: true }))).toBe("41 231 ₴");
  });
  it("formatMoney compact uses English K/M/B suffixes with uk-UA digits", () => {
    expect(n(formatMoney(41230.5, "UAH", { compact: true }))).toBe("41,2K ₴");
    expect(n(formatMoney(220000, "UAH", { compact: true }))).toBe("220K ₴");
    expect(n(formatMoney(1_500_000, "UAH", { compact: true }))).toBe("1,5M ₴");
    expect(n(formatMoney(2_000_000_000, "USD", { compact: true }))).toBe("2B $");
    expect(n(formatMoney(896.5, "UAH", { compact: true }))).toBe("896,5 ₴");
    expect(n(formatMoney(-18200, "UAH", { compact: true, signDisplay: "exceptZero" }))).toBe("-18,2K ₴");
  });
  it("formatRate / formatPercent", () => {
    expect(formatRate(44.9801)).toBe("44,9801");
    expect(formatRate(28.431)).toBe("28,4310");
    expect(n(formatPercent(0.1234))).toBe("12,3%");
  });
});
