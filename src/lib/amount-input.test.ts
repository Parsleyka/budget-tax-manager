import { describe, expect, it } from "vitest";
import { amountInputEdit, formatAmountTyping, groupThousands, parseMoneyInput } from "./money";

/** Simulate typing `chars` one by one at the end of an (initially empty) amount field. */
function typeChars(chars: string, start = ""): string {
  let text = start;
  for (const ch of chars) {
    const raw = text + ch;
    text = amountInputEdit(text, raw, raw.length, "insertText").text;
  }
  return text;
}

describe("groupThousands", () => {
  it("groups digits by three from the right", () => {
    expect(groupThousands("")).toBe("");
    expect(groupThousands("999")).toBe("999");
    expect(groupThousands("1000")).toBe("1 000");
    expect(groupThousands("10000")).toBe("10 000");
    expect(groupThousands("100000")).toBe("100 000");
    expect(groupThousands("1000000")).toBe("1 000 000");
    expect(groupThousands("100000000")).toBe("100 000 000");
  });
});

describe("formatAmountTyping", () => {
  it("groups the integer part and keeps the decimals exactly as typed", () => {
    expect(formatAmountTyping("1000")).toBe("1 000");
    expect(formatAmountTyping("100000000")).toBe("100 000 000");
    expect(formatAmountTyping("1234567,5")).toBe("1 234 567,5");
    expect(formatAmountTyping("1234567.50")).toBe("1 234 567.50");
    expect(formatAmountTyping("12345,")).toBe("12 345,");
    expect(formatAmountTyping(",5")).toBe(",5");
    expect(formatAmountTyping("-1500,00")).toBe("-1 500,00");
    expect(formatAmountTyping("")).toBe("");
  });

  it("regroups text that already has (wrong or no-break) spaces", () => {
    expect(formatAmountTyping("1 0000")).toBe("10 000");
    expect(formatAmountTyping("10 000 000")).toBe("10 000 000");
    expect(formatAmountTyping("  2500 ")).toBe("2 500");
  });

  it("leaves anything that is not a plain number untouched (validation reports it)", () => {
    expect(formatAmountTyping("1.234,56")).toBe("1.234,56");
    expect(formatAmountTyping("1,234.56")).toBe("1,234.56");
    expect(formatAmountTyping("12abc")).toBe("12abc");
    expect(formatAmountTyping("1,2,3")).toBe("1,2,3");
  });

  it("keeps ambiguous thousands-separator input ambiguous (still rejected by the parser)", () => {
    expect(formatAmountTyping("58.500")).toBe("58.500");
    expect(parseMoneyInput(formatAmountTyping("58.500"))).toBeNull();
    expect(parseMoneyInput(formatAmountTyping("58,500"))).toBeNull();
  });

  it("round-trips through parseMoneyInput", () => {
    for (const [typed, value] of [
      ["1000", 1000],
      ["100000000", 100_000_000],
      ["1234567,89", 1_234_567.89],
      ["0,5", 0.5],
      ["-250,10", -250.1],
    ] as const) {
      expect(parseMoneyInput(formatAmountTyping(typed))).toBe(value);
    }
  });
});

describe("amountInputEdit (typing in the field)", () => {
  it("groups while typing digit by digit", () => {
    expect(typeChars("1")).toBe("1");
    expect(typeChars("1000")).toBe("1 000");
    expect(typeChars("100000")).toBe("100 000");
    expect(typeChars("100000000")).toBe("100 000 000");
    expect(typeChars("1234567,89")).toBe("1 234 567,89");
  });

  it("keeps the caret next to the same digit when the grouping shifts", () => {
    // "1 000" with the caret after "1 " (index 2); typing "5" → "15 000", caret after "15".
    expect(amountInputEdit("1 000", "1 5000", 3, "insertText")).toEqual({ text: "15 000", caret: 2 });
    // Typing at the end puts the caret at the end.
    expect(amountInputEdit("100 000", "100 0000", 8, "insertText")).toEqual({ text: "1 000 000", caret: 9 });
    // Typing at the very start.
    expect(amountInputEdit("500", "1500", 1, "insertText")).toEqual({ text: "1 500", caret: 1 });
  });

  it("Backspace / Delete over a group space removes the neighbouring digit", () => {
    // "12 345", caret after the space (index 3); Backspace deletes the space → remove "2" instead.
    expect(amountInputEdit("12 345", "12345", 2, "deleteContentBackward")).toEqual({ text: "1 345", caret: 1 });
    // Caret before the space (index 2); Delete removes the space → remove "3" instead; the caret stays
    // right after "2": "1 2|45".
    expect(amountInputEdit("12 345", "12345", 2, "deleteContentForward")).toEqual({ text: "1 245", caret: 3 });
    // Normal backspace of a digit regroups.
    expect(amountInputEdit("1 000", "1 00", 4, "deleteContentBackward")).toEqual({ text: "100", caret: 3 });
  });

  it("pasting a grouped or ungrouped amount works", () => {
    expect(amountInputEdit("", "2500000,50", 10, "insertFromPaste")).toEqual({ text: "2 500 000,50", caret: 12 });
    expect(amountInputEdit("", "2 500 000,50", 12, "insertFromPaste")).toEqual({ text: "2 500 000,50", caret: 12 });
  });

  it("does not touch rates (no thousands) or invalid text", () => {
    expect(amountInputEdit("44,98", "44,980", 6, "insertText")).toEqual({ text: "44,980", caret: 6 });
    expect(amountInputEdit("12", "12a", 3, "insertText")).toEqual({ text: "12a", caret: 3 });
  });
});
