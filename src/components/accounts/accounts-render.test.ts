/**
 * Smoke render of the Accounts page pieces (server-rendered to static HTML): catches runtime errors and
 * checks the key figures / labels reach the markup. Interactions are covered by the shared dialogs.
 */
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { accountUsage, balanceSheet, computeBalances, type FxRates, type LedgerData } from "@/lib/ledger";
import { effectiveRate } from "@/lib/money";
import type { AccountsPageData, AdjustmentRow, TransferRow } from "@/server/queries";
import { account, adjustment, income, transfer } from "@/test/factories";
import { AccountGroupCard } from "./account-group-card";
import { AccountsOptionsProvider } from "./accounts-options";
import { buildGroupSections, dialogOptions } from "./accounts-view";
import { AdjustmentsSection } from "./adjustments-section";
import { TransfersSection } from "./transfers-section";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ");

function page(ledger: LedgerData, fx: FxRates): AccountsPageData {
  const balances = computeBalances(ledger);
  const acc = new Map(ledger.accounts.map((a) => [a.id, a]));
  const cur = (id: string) => acc.get(id)?.currency ?? "UAH";
  const transfers: TransferRow[] = ledger.transfers.map((t) => ({
    ...t,
    fromAccount: acc.get(t.fromAccountId) ?? null,
    toAccount: acc.get(t.toAccountId) ?? null,
    fromCurrency: cur(t.fromAccountId),
    toCurrency: cur(t.toAccountId),
    effectiveRate: effectiveRate(t.fromAmount, t.toAmount),
  }));
  const adjustments: AdjustmentRow[] = ledger.adjustments.map((a) => ({ ...a, account: acc.get(a.accountId) ?? null, currency: cur(a.accountId) }));
  return {
    today: "2026-10-15",
    rates: { today: "2026-10-15", USD: null, EUR: null, PLN: null, offline: false },
    balances: balanceSheet(ledger, fx),
    accounts: ledger.accounts.map((a) => ({ account: a, usage: accountUsage(a.id, ledger), balance: balances[a.id] ?? 0, isDefault: a.id === "main" })),
    transfers,
    adjustments,
    defaultActiveAccountId: "main",
  };
}

function render(data: AccountsPageData, node: ReactNode): string {
  return text(renderToStaticMarkup(h(TooltipProvider, null, h(AccountsOptionsProvider, { options: dialogOptions(data), children: node }))));
}

const main = account({ id: "main", name: "Main card", group: "active", currency: "UAH", openingBalance: 1000 });
const fopUsd = account({ id: "fop-usd", name: "FOP USD", group: "freelancer", currency: "USD", note: "Payoneer" });
const ibkr = account({ id: "ibkr", name: "IBKR", group: "ibkr", currency: "USD" });

describe("Accounts page pieces", () => {
  it("renders a fresh install (no movements) with quiet empty states", () => {
    const ledger: LedgerData = { accounts: [main, fopUsd], incomes: [], expenses: [], transfers: [], adjustments: [] };
    const data = page(ledger, { USD: { rate: 41.25, date: "2026-10-15", stale: false } });

    const sections = buildGroupSections(data, false);
    const deposits = render(data, h(AccountGroupCard, { section: sections[3] }));
    expect(deposits).toContain("Deposits");
    expect(deposits).toContain("No accounts");
    expect(deposits).toContain("Add account");

    expect(render(data, h(TransfersSection, { transfers: data.transfers }))).toContain("No transfers yet");
    expect(render(data, h(AdjustmentsSection, { adjustments: data.adjustments }))).toContain("No balance updates yet");
  });

  it("renders balances, UAH equivalents, transfers and adjustments — without pills, counts or rate lines", () => {
    const ledger: LedgerData = {
      accounts: [main, fopUsd, ibkr],
      incomes: [income({ accountId: "fop-usd", currency: "USD", amount: 1000, rate: 41.5 })],
      expenses: [],
      transfers: [
        transfer({ fromAccountId: "fop-usd", toAccountId: "main", fromAmount: 400, toAmount: 16_600, note: "Sold USD" }),
        transfer({ fromAccountId: "main", toAccountId: "main", fromAmount: 5, toAmount: 5 }),
      ],
      adjustments: [adjustment({ accountId: "ibkr", delta: -12.5, note: "Market value" })],
    };
    const data = page(ledger, { USD: { rate: 41.25, date: "2026-10-14", stale: true } });

    const [active, freelancer] = buildGroupSections(data, false);
    const activeHtml = render(data, h(AccountGroupCard, { section: active }));
    expect(activeHtml).toContain("Active");
    expect(activeHtml).toContain("Main card Main");
    expect(activeHtml).toContain("17 600,00 ₴");

    const fopHtml = render(data, h(AccountGroupCard, { section: freelancer }));
    expect(fopHtml).toContain("600,00 $");
    expect(fopHtml).toContain("≈ about 24 750,00 ₴");
    expect(fopHtml).not.toContain("records");
    expect(fopHtml).not.toContain("1 $ = 41,2500 ₴");
    expect(fopHtml).not.toContain("Stale");

    const transfers = render(data, h(TransfersSection, { transfers: data.transfers }));
    expect(transfers).toContain("FOP USD → Main card");
    expect(transfers).toContain("1 $ = 41,5000 ₴");
    expect(transfers).toContain("Sold USD");
    expect(transfers).not.toContain("Show all"); // 2 of at most 5

    const adjustments = render(data, h(AdjustmentsSection, { adjustments: data.adjustments }));
    expect(adjustments).toContain("−12,50 $");
    expect(adjustments).toContain("Market value");
  });

  it("shows the latest 5 transfers and a “Show all” button for the rest", () => {
    const ledger: LedgerData = {
      accounts: [main, fopUsd],
      incomes: [],
      expenses: [],
      transfers: Array.from({ length: 7 }, (_, i) => transfer({ fromAccountId: "main", toAccountId: "main", fromAmount: i + 1, toAmount: i + 1 })),
      adjustments: [],
    };
    const data = page(ledger, { USD: null });
    const html = render(data, h(TransfersSection, { transfers: data.transfers }));
    expect(html).toContain("Show all (7)");
    expect(html.match(/Main card → Main card/g)).toHaveLength(5);
  });
});
