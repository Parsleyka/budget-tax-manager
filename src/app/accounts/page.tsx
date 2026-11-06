import type { Metadata } from "next";
import { AccountsHeaderActions } from "@/components/accounts/accounts-header-actions";
import { AccountsHistory } from "@/components/accounts/accounts-history";
import { AccountsList } from "@/components/accounts/accounts-list";
import { AccountsOptionsProvider } from "@/components/accounts/accounts-options";
import { ARCHIVED_PARAM, buildGroupSections, dialogOptions, visibleSections } from "@/components/accounts/accounts-view";
import { PageHeader } from "@/components/shared/page-header";
import { firstParam } from "@/lib/periods";
import { getAccountsPageData } from "@/server/queries";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage(props: PageProps<"/accounts">) {
  const [data, searchParams] = await Promise.all([getAccountsPageData(), props.searchParams]);
  const showArchived = firstParam(searchParams[ARCHIVED_PARAM]) === "1";
  const sections = visibleSections(buildGroupSections(data, showArchived));
  const archivedCount = data.accounts.filter((a) => a.account.archived).length;

  return (
    <AccountsOptionsProvider options={dialogOptions(data)}>
      <PageHeader title="Accounts" actions={<AccountsHeaderActions showArchived={showArchived} archivedCount={archivedCount} />} />

      <AccountsList sections={sections} netWorthUah={data.balances.netWorthUah} incomplete={data.balances.missingRates.length > 0} />
      <AccountsHistory transfers={data.transfers} adjustments={data.adjustments} />
    </AccountsOptionsProvider>
  );
}
