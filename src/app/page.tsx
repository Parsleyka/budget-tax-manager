import type { Metadata } from "next";
import { cookies } from "next/headers";
import { BalanceTiles } from "@/components/overview/balance-tiles";
import { DisplayCurrencyProvider, DisplayCurrencyToggle } from "@/components/overview/display-currency";
import { DISPLAY_CURRENCY_COOKIE, parseDisplayCurrency, type DisplayRates } from "@/components/overview/display-currency-shared";
import { FrozenBreakdownCard } from "@/components/overview/frozen-breakdown-card";
import { GettingStartedCard } from "@/components/overview/getting-started-card";
import { OverviewHeaderActions } from "@/components/overview/overview-header-actions";
import { hasAnyBalance } from "@/components/overview/overview-model";
import { RecentTransactionsCard } from "@/components/overview/recent-transactions-card";
import { TaxDeadlineLine } from "@/components/overview/tax-deadline-line";
import { ThisMonthCard } from "@/components/overview/this-month-card";
import { PageHeader } from "@/components/shared/page-header";
import { getFormOptions, getOverviewData } from "@/server/queries";

export const metadata: Metadata = { title: "Overview" };

/**
 * Overview (/): Net worth with Active and Frozen, the next tax deadline, Frozen by group, this month's
 * income vs spending and the latest transactions.
 * Server Component — both loaders call `connection()`, so the route renders dynamically.
 */
export default async function OverviewPage() {
  const [data, options, cookieStore] = await Promise.all([getOverviewData(), getFormOptions(), cookies()]);
  // "Show in ₴ / $ / € / zł": a view of the UAH totals at today's NBU rates (nothing stored changes).
  const rates: DisplayRates = { USD: data.rates.USD?.rate ?? null, EUR: data.rates.EUR?.rate ?? null, PLN: data.rates.PLN?.rate ?? null };
  const displayCurrency = parseDisplayCurrency(cookieStore.get(DISPLAY_CURRENCY_COOKIE)?.value, rates);
  const fresh = data.isEmpty && !hasAnyBalance(data.balances);

  return (
    <DisplayCurrencyProvider initial={displayCurrency} rates={rates}>
      <PageHeader
        title="Overview"
        actions={
          <>
            <DisplayCurrencyToggle />
            <OverviewHeaderActions options={options} />
          </>
        }
      />

      {fresh ? <GettingStartedCard options={options} /> : null}

      <BalanceTiles balances={data.balances} />
      <TaxDeadlineLine deadlines={data.taxDeadlines} paymentStatus={data.taxPaymentStatus} overdue={data.taxOverdue} />

      <div className="grid items-start gap-8 lg:grid-cols-2">
        <FrozenBreakdownCard balances={data.balances} />
        <ThisMonthCard thisMonth={data.thisMonth} />
      </div>

      <RecentTransactionsCard rows={data.recent} today={data.today} />
    </DisplayCurrencyProvider>
  );
}
