import { describe, expect, it } from "vitest";
import { taxSettings } from "@/test/factories";
import {
  canToggleUncovered,
  draftFromTax,
  esvYearPreview,
  inEmploymentWindow,
  parsePercentInput,
  percentToInput,
  previewTaxFromDraft,
  sameTax,
  taxFromDraft,
  toggleMonth,
} from "./tax-form-model";

describe("percent input", () => {
  it("parses comma/dot decimals and a trailing %", () => {
    expect(parsePercentInput("5")).toBe(5);
    expect(parsePercentInput("1,5")).toBe(1.5);
    expect(parsePercentInput("2.25 %")).toBe(2.25);
    expect(parsePercentInput("0")).toBe(0);
    expect(parsePercentInput("100")).toBe(100);
  });
  it("rejects out-of-range, too precise and garbage", () => {
    expect(parsePercentInput("")).toBeNull();
    expect(parsePercentInput("-1")).toBeNull();
    expect(parsePercentInput("100,01")).toBeNull();
    expect(parsePercentInput("1,234")).toBeNull();
    expect(parsePercentInput("abc")).toBeNull();
  });
  it("formats with a comma", () => {
    expect(percentToInput(null)).toBe("");
    expect(percentToInput(5)).toBe("5");
    expect(percentToInput(1.25)).toBe("1,25");
  });
});

describe("draft ⇄ tax settings", () => {
  it("round-trips every field", () => {
    const tax = taxSettings({
      vatPayer: true,
      singleTaxRateOverridePct: 4.5,
      militaryLevyRateOverridePct: 1,
      militaryLevyEndDate: "2030-12-31",
      esvMode: "custom",
      employedFrom: "2024-02-01",
      employedTo: "2026-06-30",
      esvUncoveredMonths: ["2026-03", "2025-11"],
      esvCustomMonthlyBase: 20000,
      fopRegisteredOn: "2023-05-10",
    });
    const res = taxFromDraft(draftFromTax(tax));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tax).toEqual({ ...tax, esvUncoveredMonths: ["2025-11", "2026-03"] });
      expect(sameTax(res.tax, tax)).toBe(true);
    }
  });

  it("drops overrides that are switched off", () => {
    const draft = { ...draftFromTax(taxSettings({ singleTaxRateOverridePct: 4 })), singleTaxOverrideOn: false };
    const res = taxFromDraft(draft);
    expect(res.ok && res.tax.singleTaxRateOverridePct).toBe(null);
  });

  it("reports invalid percents under the server keys", () => {
    const draft = { ...draftFromTax(taxSettings()), singleTaxOverrideOn: true, singleTaxOverride: "250", levyOverrideOn: true, levyOverride: "x" };
    const res = taxFromDraft(draft);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(Object.keys(res.errors).sort()).toEqual(["tax.militaryLevyRateOverridePct", "tax.singleTaxRateOverridePct"]);
    }
  });

  it("requires a valid base in custom mode only", () => {
    const base = draftFromTax(taxSettings());
    const missing = taxFromDraft({ ...base, esvMode: "custom", customBase: "" });
    expect(!missing.ok && missing.errors["tax.esvCustomMonthlyBase"]).toEqual(["Enter the monthly base"]);
    const bad = taxFromDraft({ ...base, esvMode: "custom", customBase: "-5" });
    expect(bad.ok).toBe(false);
    const ok = taxFromDraft({ ...base, esvMode: "custom", customBase: "20 000,50" });
    expect(ok.ok && ok.tax.esvCustomMonthlyBase).toBe(20000.5);
    // Not custom: an invalid hidden base is ignored rather than blocking the save.
    const hidden = taxFromDraft({ ...base, esvMode: "minimum", customBase: "oops" });
    expect(hidden.ok && hidden.tax.esvCustomMonthlyBase).toBe(null);
  });

  it("rejects an employment window that ends before it starts", () => {
    const res = taxFromDraft({ ...draftFromTax(taxSettings({ esvMode: "employed" })), employedFrom: "2026-05-01", employedTo: "2026-01-31" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors["tax.employedTo"]?.length).toBe(1);
  });

  it("preview falls back to saved values while typing", () => {
    const saved = taxSettings({ singleTaxRateOverridePct: 4, esvCustomMonthlyBase: 10000 });
    const draft = { ...draftFromTax(saved), singleTaxOverride: "4,", customBase: "" };
    const preview = previewTaxFromDraft(draft, saved);
    expect(preview.singleTaxRateOverridePct).toBe(4);
    expect(preview.esvCustomMonthlyBase).toBe(10000);
  });

  it("sameTax ignores uncovered-month order and duplicates", () => {
    const a = taxSettings({ esvUncoveredMonths: ["2026-03", "2026-01"] });
    const b = taxSettings({ esvUncoveredMonths: ["2026-01", "2026-03", "2026-01"] });
    expect(sameTax(a, b)).toBe(true);
    expect(sameTax(a, taxSettings({ esvUncoveredMonths: ["2026-01"] }))).toBe(false);
  });
});

describe("uncovered months", () => {
  it("toggles and keeps the list sorted", () => {
    expect(toggleMonth(["2026-05"], "2026-02")).toEqual(["2026-02", "2026-05"]);
    expect(toggleMonth(["2026-02", "2026-05"], "2026-02")).toEqual(["2026-05"]);
  });

  it("employment window is month-granular and open-ended on null", () => {
    const w = { employedFrom: "2025-03-20", employedTo: null };
    expect(inEmploymentWindow("2025-02", w)).toBe(false);
    expect(inEmploymentWindow("2025-03", w)).toBe(true);
    expect(inEmploymentWindow("2030-01", w)).toBe(true);
    expect(inEmploymentWindow("2026-07", { employedFrom: null, employedTo: "2026-06-01" })).toBe(false);
  });

  it("only employed-mode months inside the window (or already flagged) are toggleable", () => {
    const tax = taxSettings({ esvMode: "employed", employedFrom: "2025-01-01", employedTo: "2026-06-30", fopRegisteredOn: "2025-03-01" });
    expect(canToggleUncovered("2025-05", tax)).toBe(true);
    expect(canToggleUncovered("2025-02", tax)).toBe(false); // before registration
    expect(canToggleUncovered("2026-07", tax)).toBe(false); // after the job ended
    expect(canToggleUncovered("2026-07", { ...tax, esvUncoveredMonths: ["2026-07"] })).toBe(true);
    expect(canToggleUncovered("2025-05", { ...tax, esvMode: "minimum" })).toBe(false);
  });
});

describe("ЄСВ year preview", () => {
  it("minimum mode 2026 = 12 × 1 902,34 (quarter 5 707,02)", () => {
    const p = esvYearPreview(2026, taxSettings({ esvMode: "minimum" }));
    expect(p.quarters).toEqual([5707.02, 5707.02, 5707.02, 5707.02]);
    expect(p.total).toBe(22828.08);
    expect(p.dueCount).toBe(12);
  });

  it("follows the mid-year МЗП change in 2024", () => {
    const p = esvYearPreview(2024, taxSettings({ esvMode: "minimum" }));
    expect(p.quarters[0]).toBe(4686);
    expect(p.quarters[1]).toBe(5280);
  });

  it("employed mode charges only uncovered months", () => {
    const p = esvYearPreview(2026, taxSettings({ esvMode: "employed", esvUncoveredMonths: ["2026-02", "2026-08"] }));
    expect(p.dueCount).toBe(2);
    expect(p.total).toBe(3804.68);
    expect(p.months[1].reason).toBe("uncovered");
    expect(p.months[0].reason).toBe("employed");
  });

  it("no ЄСВ before the registration month", () => {
    const p = esvYearPreview(2026, taxSettings({ esvMode: "minimum", fopRegisteredOn: "2026-10-20" }));
    expect(p.dueCount).toBe(3);
    expect(p.months[8].reason).toBe("before-registration");
  });
});

describe("TAX-5: ЄСВ exemption settings in the form", () => {
  it("round-trips the 2024 opt-out, exempt periods and the deregistration date", () => {
    const tax = taxSettings({
      esvMode: "minimum",
      fopRegisteredOn: "2023-05-10",
      fopDeregisteredOn: "2026-12-31",
      esv2024OptOut: true,
      esvExemptPeriods: [{ from: "2025-03", to: "2025-05", note: "Military service" }, { from: "2026-09", to: null }],
    });
    const draft = draftFromTax(tax);
    expect(draft.esvExemptPeriods).toEqual([
      { from: "2025-03", to: "2025-05", note: "Military service", militaryService: false },
      { from: "2026-09", to: null, note: "", militaryService: false },
    ]);
    const res = taxFromDraft(draft);
    expect(res.ok && res.tax).toEqual(tax);
    expect(res.ok && sameTax(res.tax, tax)).toBe(true);
    // Settings saved before these fields existed compare equal to the defaults.
    const legacy = { ...taxSettings() } as Record<string, unknown>;
    delete legacy.esvExemptPeriods;
    delete legacy.esv2024OptOut;
    delete legacy.fopDeregisteredOn;
    expect(sameTax(legacy as never, taxSettings())).toBe(true);
  });
  it("validates rows in display order and the preview ignores unfinished rows", () => {
    const base = draftFromTax(taxSettings({ esvMode: "minimum" }));
    const bad = taxFromDraft({
      ...base,
      esvExemptPeriods: [
        { from: "2026-05", to: "2026-03", note: "", militaryService: false },
        { from: "", to: null, note: "", militaryService: false },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors["tax.esvExemptPeriods.0.to"]).toEqual(["“To” must not be before “From”"]);
      expect(bad.errors["tax.esvExemptPeriods.1.from"]).toEqual(["Choose the first exempt month"]);
    }
    const preview = previewTaxFromDraft(
      { ...base, esvExemptPeriods: [{ from: "2026-01", to: "2026-02", note: "", militaryService: false }, { from: "", to: null, note: "", militaryService: false }] },
      taxSettings(),
    );
    expect(preview.esvExemptPeriods).toEqual([{ from: "2026-01", to: "2026-02" }]);
    expect(esvYearPreview(2026, preview).quarters[0]).toBe(1902.34);
  });
  it("round-trips the military-service flag (also exempts the single tax and levy) and compares it", () => {
    const tax = taxSettings({ esvMode: "employed", esvExemptPeriods: [{ from: "2025-03", to: "2025-05", note: "Mobilised", militaryService: true }] });
    const draft = draftFromTax(tax);
    expect(draft.esvExemptPeriods[0].militaryService).toBe(true);
    const res = taxFromDraft(draft);
    expect(res.ok && res.tax).toEqual(tax);
    // An unticked flag is not stored, and toggling it counts as a change.
    const off = taxFromDraft({ ...draft, esvExemptPeriods: [{ ...draft.esvExemptPeriods[0], militaryService: false }] });
    expect(off.ok && off.tax.esvExemptPeriods).toEqual([{ from: "2025-03", to: "2025-05", note: "Mobilised" }]);
    expect(off.ok && sameTax(off.tax, tax)).toBe(false);
  });
  it("deregistration before registration is refused", () => {
    const res = taxFromDraft({ ...draftFromTax(taxSettings()), fopRegisteredOn: "2025-01-10", fopDeregisteredOn: "2024-12-31" });
    expect(!res.ok && res.errors["tax.fopDeregisteredOn"]).toEqual(["Deregistration must not be before registration"]);
  });
});
