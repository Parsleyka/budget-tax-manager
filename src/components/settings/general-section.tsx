import { SectionCard } from "@/components/shared/section-card";
import type { SettingsPageData } from "@/server/queries";
import { DefaultAccountForm } from "./default-account-form";

/** Settings → General: the main (default active) bank account. */
export function GeneralSection({
  accounts,
  defaultActiveAccountId,
}: {
  accounts: SettingsPageData["accounts"];
  defaultActiveAccountId: string;
}) {
  const eligible = accounts
    .map((a) => a.account)
    .filter((a) => a.group === "active" && a.currency === "UAH" && !a.archived);
  const balances = Object.fromEntries(accounts.map((a) => [a.account.id, a.balance]));

  return (
    <SectionCard title="Main bank account">
      {eligible.length ? (
        <DefaultAccountForm accounts={eligible} value={defaultActiveAccountId} balances={balances} />
      ) : (
        <p className="text-sm text-muted-foreground">No UAH account in the Active group.</p>
      )}
    </SectionCard>
  );
}
