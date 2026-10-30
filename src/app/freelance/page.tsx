import type { Metadata } from "next";
import { DeclarationSection } from "@/components/freelance/declaration-section";
import { EsvToggle } from "@/components/freelance/esv-toggle";
import { FreelanceHeaderActions } from "@/components/freelance/freelance-header-actions";
import { IncomesSection } from "@/components/freelance/incomes-section";
import { defaultPaymentPeriod, parseMonthsParam, pickNextDeadline } from "@/components/freelance/model";
import { FreelanceMonthPicker } from "@/components/freelance/month-picker";
import { OverdueAlert } from "@/components/freelance/overdue-alert";
import { SelectionAlerts } from "@/components/freelance/selection-alerts";
import { FreelanceSelectionProvider } from "@/components/freelance/selection-context";
import { TaxSummary } from "@/components/freelance/tax-summary";
import { UpcomingDeadlines } from "@/components/freelance/upcoming-deadlines";
import { PageHeader } from "@/components/shared/page-header";
import { firstParam } from "@/lib/periods";
import { getFormOptions, getFreelancePageData } from "@/server/queries";

export const metadata: Metadata = { title: "Freelancer" };

/**
 * Search params: `year` (read by the loader), `months` (e.g. "1-3,7" or "none"; default YTD / whole past
 * year) and `esv=1` ("Include ЄСВ": preview the minimum ЄСВ as optional when the saved mode owes none).
 */
export default async function FreelancePage(props: PageProps<"/freelance">) {
  const searchParams = await props.searchParams;
  const [data, options] = await Promise.all([getFreelancePageData(searchParams), getFormOptions()]);

  const initialMonths = parseMonthsParam(firstParam(searchParams.months), data.year) ?? data.defaultMonths;
  // Cross-year (viewed year, last year, this year, years with overdue items): in Jan–Feb last year's Q4
  // is what is due, whatever year is being viewed.
  const paymentQuarters = data.paymentOptions;
  // Upcoming deadlines can belong to the previous year (Q4 in Jan–Feb): use the cross-year statuses.
  const next = pickNextDeadline(data.upcomingDeadlines, data.upcomingPaymentStatus);
  // ФОП taxes are usually paid from the ФОП's own UAH account; fall back to the main account.
  const payFromId = data.uahAccounts.find((a) => a.group === "freelancer")?.id ?? data.defaultActiveAccountId;
  // "Include ЄСВ": view-only minimum ЄСВ per quarter (undefined while off — nothing changes then).
  const optionalEsv = data.esvOptional.included ? data.esvOptional.byQuarter : undefined;
  const payment = { quarters: paymentQuarters, accounts: data.uahAccounts, defaultAccountId: payFromId, today: data.today, optionalEsv };
  // Only what the header's income / transfer dialogs need (keeps categories out of the client payload).
  const dialogOptions = {
    today: options.today,
    accounts: options.accounts,
    balances: options.balances,
    defaultActiveAccountId: options.defaultActiveAccountId,
    defaultFreelancerAccountIds: options.defaultFreelancerAccountIds,
  };

  return (
    <FreelanceSelectionProvider
      key={data.year}
      year={data.year}
      initialMonths={initialMonths}
      incomes={data.taxIncomes}
      settings={data.viewSettings}
    >
      <PageHeader
        title="Freelancer"
        actions={<FreelanceHeaderActions options={dialogOptions} payment={payment} defaultPeriod={defaultPaymentPeriod(paymentQuarters)} />}
      >
        <FreelanceMonthPicker years={data.years} today={data.today} />
        {data.esvOptional.available ? <EsvToggle included={data.esvOptional.included} /> : null}
      </PageHeader>

      {/* Overdue items of every watched year, not just the one being viewed. */}
      <OverdueAlert items={data.overdue} {...payment} />
      <SelectionAlerts />

      <TaxSummary
        settings={data.settings}
        limit={data.declaration.limit}
        paymentStatus={data.paymentStatus}
        esvOptional={data.esvOptional.included}
        aside={<UpcomingDeadlines deadlines={data.upcomingDeadlines} statuses={data.upcomingPaymentStatus} next={next} optionalEsv={optionalEsv} />}
      />

      <IncomesSection rows={data.incomes} options={dialogOptions} />

      <DeclarationSection
        declaration={data.declaration}
        statuses={data.paymentStatus}
        today={data.today}
        next={next}
        paymentQuarters={paymentQuarters}
        accounts={data.uahAccounts}
        defaultAccountId={payFromId}
        optionalEsv={optionalEsv}
      />
    </FreelanceSelectionProvider>
  );
}
