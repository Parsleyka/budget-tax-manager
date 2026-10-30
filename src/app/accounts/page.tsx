import type { Metadata } from "next";
import { AccountGroupCard } from "@/components/accounts/account-group-card";
import { AccountsHeaderActions } from "@/components/accounts/accounts-header-actions";
import { AccountsOptionsProvider } from "@/components/accounts/accounts-options";
import { ARCHIVED_PARAM, buildGroupSections, dialogOptions } from "@/components/accounts/accounts-view";
import { AdjustmentsSection } from "@/components/accounts/adjustments-section";
import { TransfersSection } from "@/components/accounts/transfers-section";
import { PageHeader } from "@/components/shared/page-header";
import { firstParam } from "@/lib/periods";
import { getAccountsPageData } from "@/server/queries";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage(props: PageProps<"/accounts">) {
  const [data, searchParams] = await Promise.all([getAccountsPageData(), props.searchParams]);
  const showArchived = firstParam(searchParams[ARCHIVED_PARAM]) === "1";
  const sections = buildGroupSections(data, showArchived);
  const archivedCount = data.accounts.filter((a) => a.account.archived).length;

  return (
    <AccountsOptionsProvider options={dialogOptions(data)}>
      <PageHeader title="Accounts" actions={<AccountsHeaderActions showArchived={showArchived} archivedCount={archivedCount} />} />

      {sections.map((section) => (
        <AccountGroupCard key={section.group} section={section} />
      ))}

      <TransfersSection transfers={data.transfers} />
      <AdjustmentsSection adjustments={data.adjustments} />
    </AccountsOptionsProvider>
  );
}
