import type { Metadata } from "next";
import { signedPercent } from "@/components/investments/format";
import { InvestmentAccountRow } from "@/components/investments/investment-account-row";
import { InvestmentsHeaderActions } from "@/components/investments/investments-header-actions";
import { InvestmentsSummary } from "@/components/investments/investments-summary";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { TRACKED_GROUP_COPY } from "@/lib/investments";
import { getFormOptions, getInvestmentsPageData } from "@/server/queries";

export const metadata: Metadata = { title: "Investments" };

/**
 * Investments (/investments): investment accounts (group "ibkr": IBKR, …) and bank deposits (group
 * "deposits") — money put in / taken out, manual value / balance updates and the gain (or interest).
 * Their value is part of the Frozen balance (as Investments and Deposits).
 */
export default async function InvestmentsPage() {
  const [data, formOptions] = await Promise.all([getInvestmentsPageData(), getFormOptions()]);
  const options = { today: data.today, investmentAccounts: data.investmentAccounts, otherAccounts: data.otherAccounts };
  const transferOptions = { today: formOptions.today, accounts: formOptions.accounts, balances: formOptions.balances };
  const current = Object.fromEntries(data.summaries.map((s) => [s.account.id, { value: s.value, netDeposited: s.netDeposited }]));

  return (
    <>
      <PageHeader title="Investments" actions={<InvestmentsHeaderActions options={options} current={current} />} />

      {data.summaries.length === 0 ? (
        <EmptyState title="No investment or deposit accounts" description="Add one from the … menu." />
      ) : (
        <>
          <InvestmentsSummary totals={data.totals} summaries={data.summaries} />
          {data.sections.map((section) => {
            const t = section.totals;
            return (
              <SectionCard
                key={section.group}
                id={`section-${section.group}`}
                title={TRACKED_GROUP_COPY[section.group].title}
                description={
                  <>
                    <Money amount={t.valueUah} currency="UAH" />
                    {" · "}
                    <Money amount={t.gainUah} currency="UAH" signed />
                    {t.returnPct !== null ? ` (${signedPercent(t.returnPct)})` : ""}
                  </>
                }
              >
                <div>
                  {section.summaries.map((s) => (
                    <InvestmentAccountRow key={s.account.id} summary={s} fx={data.fx} options={options} transferOptions={transferOptions} current={current} />
                  ))}
                </div>
              </SectionCard>
            );
          })}
        </>
      )}
    </>
  );
}
