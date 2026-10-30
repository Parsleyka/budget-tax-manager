/**
 * Server-render smoke tests for the Income page components (no browser): the column logic, the
 * mobile cards, the totals footer and the figures render the right data.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { feeUah, receivedUah } from "@/lib/analytics";
import type { Income } from "@/lib/types";
import type { IncomeRow } from "@/server/queries";
import { account, income } from "@/test/factories";
import { IncomeRecords } from "./income-records";
import { IncomeSummary } from "./income-summary";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/[  ]/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const main = account({ id: "main", name: "Main card" });
const fopUsd = account({ id: "fop-usd", name: "FOP USD", group: "freelancer", currency: "USD" });

const row = (i: Income): IncomeRow => ({
  ...i,
  account: [main, fopUsd].find((a) => a.id === i.accountId) ?? null,
  receivedUah: receivedUah(i),
  feeUah: feeUah(i),
});

const salary = row(income({ kind: "salary", amount: 41230.5, date: "2026-10-01", accountId: "main", counterparty: "Company LLC" }));
const freelance = row(
  income({
    kind: "freelance",
    currency: "USD",
    amount: 1234.56,
    rate: 44.9801,
    fee: 10.1,
    date: "2026-10-09",
    accountId: "fop-usd",
    counterparty: "Acme Inc.",
    note: "Invoice #42",
  }),
);

const options = {
  today: "2026-10-15",
  accounts: [main, fopUsd],
  defaultActiveAccountId: "main",
  defaultFreelancerAccountIds: { USD: "fop-usd" },
};

const render = (rows: IncomeRow[], kind: "all" | "salary" | "freelance") =>
  renderToStaticMarkup(createElement(IncomeRecords, { rows, kind, options, caption: "Income" }));

describe("IncomeRecords", () => {
  it("shows the source, original amount (rate under it) and UAH columns on the All tab with mixed rows", () => {
    const html = render([freelance, salary], "all");
    const t = text(html);
    for (const h of ["Date", "Source", "Amount", "In UAH"]) {
      expect(html).toContain(`>${h}<`);
    }
    for (const h of ["Type", "Account", "NBU rate", "Fee"]) {
      expect(html).not.toContain(`>${h}<`);
    }
    expect(t).toContain("Acme Inc.");
    expect(t).toContain("Freelance · FOP USD · Invoice #42");
    expect(t).toContain("Salary · Main card");
    expect(t).toContain("44,9801");
    expect(t).toContain("1 234,56 $");
    expect(t).toContain("55 530,63 ₴");
    expect(t).toContain("after fee 55 076,33 ₴");
    // Footer: totals before (per currency) and after exchange.
    expect(t).toContain("Total · 2 incomes");
    expect(t).toContain("96 761,13 ₴");
    // One actions menu per row in the table and in the cards (2 rows × 2 views).
    expect(html.match(/aria-label="Actions for /g)?.length).toBe(4);
    expect(html).toContain('aria-label="Actions for freelance income of 1');
  });

  it("drops the FX columns on the Salary tab", () => {
    const html = render([salary], "salary");
    expect(html).not.toContain(">NBU rate<");
    expect(html).not.toContain(">In UAH<");
    expect(html).toContain(">Employer<");
    expect(html).toContain(">Amount<");
    expect(text(html)).toContain("41 230,50 ₴");
    expect(text(html)).not.toContain("Salary · Main card"); // the kind is obvious on its own tab
  });

  it("shows the NBU rate as its own column on the Freelance tab", () => {
    const uahFreelance = row(income({ kind: "freelance", amount: 5000, accountId: "main" }));
    const html = render([uahFreelance], "freelance");
    expect(html).toContain(">Client<");
    expect(html).toContain(">NBU rate<");
  });
});

describe("IncomeSummary", () => {
  it("renders the total, salary and freelance figures", () => {
    const html = renderToStaticMarkup(
      createElement(IncomeSummary, { totals: { count: 3, salaryCount: 0, freelanceCount: 0, salaryUah: 30000, freelanceUah: 70500, feesUah: 500, receivedUah: 100000 } }),
    );
    const t = text(html);
    expect(t).toContain("Total received 100 000,00 ₴ 3 incomes");
    expect(t).toContain("Salary 30 000,00 ₴");
    expect(t).toContain("Freelance 70 500,00 ₴ fees 500,00 ₴");
  });

  it("renders an empty period", () => {
    const html = renderToStaticMarkup(
      createElement(IncomeSummary, { totals: { count: 0, salaryCount: 0, freelanceCount: 0, salaryUah: 0, freelanceUah: 0, feesUah: 0, receivedUah: 0 } }),
    );
    expect(text(html)).toContain("No income in this period");
  });
});
