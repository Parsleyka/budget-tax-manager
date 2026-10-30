import { describe, expect, it } from "vitest";
import { convertFromUah, convertToUah } from "@/lib/money";
import { parseDisplayCurrency } from "./display-currency-shared";

describe("Overview display currency (view only)", () => {
  it("converts UAH to another currency exactly (half-up to cents), sign kept", () => {
    expect(convertFromUah(41500, 41.5)).toBe(1000);
    expect(convertFromUah(386498.51, 45.051)).toBe(8579.13); // 386 498,51 ₴ / 45,0510
    expect(convertFromUah(-100, 50.435)).toBe(-1.98);
    expect(convertFromUah(0, 11.5401)).toBe(0);
    // Round trip stays within a cent per unit of rate rounding.
    expect(Math.abs(convertToUah(convertFromUah(12345.67, 45.051), 45.051) - 12345.67)).toBeLessThan(0.3);
  });

  it("accepts only a currency with a rate today; anything else is UAH", () => {
    const rates = { USD: 45.051, EUR: 50.435, PLN: null };
    expect(parseDisplayCurrency("USD", rates)).toBe("USD");
    expect(parseDisplayCurrency("EUR", rates)).toBe("EUR");
    expect(parseDisplayCurrency("PLN", rates)).toBe("UAH"); // no rate → UAH
    expect(parseDisplayCurrency("GBP", rates)).toBe("UAH");
    expect(parseDisplayCurrency(undefined, rates)).toBe("UAH");
    expect(parseDisplayCurrency("UAH", rates)).toBe("UAH");
  });
});
