import type { Metadata } from "next";
import { DebtsHeaderActions, DebtsSection } from "@/components/debts/debts-section";
import { DebtsSummary } from "@/components/debts/debts-summary";
import { DebtsViewTabs } from "@/components/debts/debts-view-tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { getDebtsPageData } from "@/server/queries";

export const metadata: Metadata = { title: "Debts" };

/**
 * Debts (/debts): money you lent (owed to you) and borrowed (you owe), with due dates and repayments.
 * Overdue and soon-due debts come first; the Overview and the sidebar badge surface them too.
 */
export default async function DebtsPage(props: PageProps<"/debts">) {
  const searchParams = await props.searchParams;
  const data = await getDebtsPageData(searchParams);
  const dialogOptions = { today: data.today, accounts: data.accounts, defaultActiveAccountId: data.defaultActiveAccountId };
  const hasAny = data.counts.open + data.counts.settled > 0;

  return (
    <>
      <PageHeader title="Debts" actions={<DebtsHeaderActions options={dialogOptions} people={data.people} />} />

      {hasAny ? (
        <>
          <DebtsSummary summary={data.summary} />
          <DebtsViewTabs view={data.view} counts={data.counts}>
            <div className="flex flex-col gap-8">
              <DebtsSection direction="lent" rows={data.lent} view={data.view} options={dialogOptions} people={data.people} />
              <DebtsSection direction="borrowed" rows={data.borrowed} view={data.view} options={dialogOptions} people={data.people} />
            </div>
          </DebtsViewTabs>
        </>
      ) : (
        <EmptyState title="No debts yet" />
      )}
    </>
  );
}
