import "server-only";
import { nowIso } from "@/lib/dates";
import { checkDefaultActiveAccount } from "@/lib/integrity";
import { SettingsInputSchema, TaxSettingsSchema, zodFieldErrors } from "@/lib/schemas";
import type { ActionResult, Settings, TaxSettings } from "@/lib/types";
import { DB_WRITE_LOCK, withLock } from "../db/mutex";
import { accountsRepo, settingsRepo } from "../db/repositories";
import { fail, fromProblem, fromZod, guard } from "./result";

/**
 * Patch settings: `{ tax?: Partial<TaxSettings>, defaultActiveAccountId? }`. The merged result is
 * validated in full. Field-error keys are prefixed ("tax.employedTo", "defaultActiveAccountId").
 */
export function updateSettings(input: unknown): Promise<ActionResult<Settings>> {
  return guard(async () => {
    const parsed = SettingsInputSchema.safeParse(input);
    if (!parsed.success) return fromZod(parsed.error);
    const patch = parsed.data;
    return withLock(DB_WRITE_LOCK, async () => {
      const current = await settingsRepo.get();
      const mergedTax: TaxSettings = { ...current.tax, ...(patch.tax ?? {}) };
      mergedTax.esvUncoveredMonths = [...new Set(mergedTax.esvUncoveredMonths)].sort();
      const taxCheck = TaxSettingsSchema.safeParse(mergedTax);
      if (!taxCheck.success) {
        const fe = zodFieldErrors(taxCheck.error);
        return fail(
          "Please fix the highlighted fields.",
          Object.fromEntries(Object.entries(fe).map(([k, v]) => [`tax.${k}`, v])),
        );
      }
      if (mergedTax.esvMode === "custom" && mergedTax.esvCustomMonthlyBase === null) {
        return fail("Enter the monthly ЄСВ base for the custom mode", {
          "tax.esvCustomMonthlyBase": ["Enter the monthly base"],
        });
      }
      const defaultId = patch.defaultActiveAccountId ?? current.defaultActiveAccountId;
      if (patch.defaultActiveAccountId !== undefined) {
        const problem = checkDefaultActiveAccount(defaultId, await accountsRepo.list());
        if (problem) return fromProblem(problem);
      }
      const next: Settings = { ...current, tax: taxCheck.data, defaultActiveAccountId: defaultId, updatedAt: nowIso() };
      await settingsRepo.update(() => ({ settings: next }));
      return { ok: true, data: next };
    });
  });
}
