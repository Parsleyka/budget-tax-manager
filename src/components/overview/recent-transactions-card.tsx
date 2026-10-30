import Link from "next/link";
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { ISODate } from "@/lib/dates";
import type { TransactionRow } from "@/lib/transactions";
import { cn } from "@/lib/utils";
import { relativeDayLabel, transactionHref } from "./overview-model";

/** How many of the latest movements the Overview lists. */
export const RECENT_COUNT = 5;

const TYPE_LABELS: Record<TransactionRow["type"], string> = {
  income: "Income",
  expense: "Spending",
  transfer: "Transfer",
  adjustment: "Balance update",
  repayment: "Debt repayment",
};

function TxRow({ row, today }: { row: TransactionRow; today: ISODate }) {
  const where =
    row.type === "transfer" ? `${row.accountName} → ${row.toAccountName ?? "Unknown account"}` : row.accountName;
  const note = row.type === "transfer" ? (row.subtitle !== where ? row.subtitle : undefined) : row.subtitle;
  return (
    <li className="first:[&>a]:pt-0">
      <Link
        href={transactionHref(row)}
        data-testid={`recent-${row.type}`}
        className={cn(
          "flex min-w-0 items-center justify-between gap-3 py-2.5 outline-none",
          "hover:[&_[data-slot=tx-title]]:underline focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm" data-slot="tx-title">
            <span className="sr-only">{TYPE_LABELS[row.type]}: </span>
            {row.title}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            <time dateTime={row.date}>{relativeDayLabel(row.date, today)}</time> · {where}
            {note ? ` · ${note}` : ""}
          </span>
        </div>
        <Money amount={row.amount} currency={row.currency} direction={row.direction} className="shrink-0 text-sm font-medium" />
      </Link>
    </li>
  );
}

/** The latest movements across incomes, spendings, transfers and balance updates — each links to its page. */
export function RecentTransactionsCard({ rows, today, className }: { rows: TransactionRow[]; today: ISODate; className?: string }) {
  return (
    <SectionCard
      className={className}
      title="Recent"
      action={
        rows.length > 0 ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href="/expenses">All spendings</Link>
          </Button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No transactions yet.</p>
      ) : (
        <ul className="flex flex-col divide-y" data-testid="recent-transactions">
          {rows.slice(0, RECENT_COUNT).map((row) => (
            <TxRow key={row.key} row={row} today={today} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
