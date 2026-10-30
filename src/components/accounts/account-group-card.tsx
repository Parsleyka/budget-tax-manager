import { AccountDialog } from "@/components/forms/account-dialog";
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { AccountRowActions } from "./account-row-actions";
import type { AccountRowView, GroupSectionView } from "./accounts-view";

/** One account group (Active / Freelancer / Investments / Deposits / Other): its UAH total and accounts. */
export function AccountGroupCard({ section, className }: { section: GroupSectionView; className?: string }) {
  return (
    <SectionCard
      id={`group-${section.group}`}
      title={section.label}
      action={<GroupTotal section={section} />}
      className={className}
    >
      {section.rows.length > 0 ? (
        <ul role="list" aria-label={`${section.label} accounts`} className="flex flex-col divide-y">
          {section.rows.map((row) => (
            <AccountRow key={row.account.id} row={row} />
          ))}
        </ul>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {section.archivedCount > 0 ? "Only archived accounts" : "No accounts"}
          </p>
          <AccountDialog
            defaults={{ group: section.group }}
            trigger={
              <Button size="sm" variant="ghost">
                Add account
              </Button>
            }
          />
        </div>
      )}
    </SectionCard>
  );
}

function GroupTotal({ section }: { section: GroupSectionView }) {
  return (
    <span className="flex items-baseline gap-2 text-right">
      {section.incomplete ? <span className="text-xs text-warning">partial</span> : null}
      <span className="sr-only">{section.label} total in UAH:</span>
      <Money amount={section.totalUah} currency="UAH" className="text-sm font-medium" />
    </span>
  );
}

function AccountRow({ row }: { row: AccountRowView }) {
  const { account, usage, balance, isDefault } = row;
  return (
    <li className="flex items-center gap-3 py-2 first:pt-0" data-testid="account-row" data-account={account.name}>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className={cn("truncate text-sm", account.archived && "text-muted-foreground")} title={account.note ?? account.name}>
          {account.name}
        </span>
        {isDefault ? (
          <span className="shrink-0 text-xs text-muted-foreground" title="Default account for salary and spendings">
            Main
          </span>
        ) : null}
        {account.archived ? <span className="shrink-0 text-xs text-muted-foreground">archived</span> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end text-right">
        <Money
          amount={balance}
          currency={account.currency}
          className={cn("text-sm font-medium", balance < 0 && "text-negative")}
          data-testid="account-balance"
        />
        {account.currency !== "UAH" ? <UahEquivalent row={row} /> : null}
      </div>
      <AccountRowActions account={account} usage={usage} balance={balance} isDefault={isDefault} />
    </li>
  );
}

/** "≈ 24 750,00 ₴" (the NBU rate and its date in the tooltip). */
function UahEquivalent({ row }: { row: AccountRowView }) {
  if (row.balanceUah === null || row.rate === null) {
    return (
      <span className="text-xs text-warning" role="status">
        No NBU rate
      </span>
    );
  }
  const rateTitle = `NBU rate${row.stale ? " (latest available)" : ""}${row.rateDate ? ` of ${formatDate(row.rateDate)}` : ""}`;
  return (
    <span className="text-xs text-muted-foreground" title={rateTitle}>
      <span aria-hidden>≈ </span>
      <span className="sr-only">about </span>
      <Money amount={row.balanceUah} currency="UAH" />
    </span>
  );
}
