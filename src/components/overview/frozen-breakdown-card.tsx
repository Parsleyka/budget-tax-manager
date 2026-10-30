import Link from "next/link";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import type { BalanceSheet } from "@/lib/ledger";
import { formatPercent } from "@/lib/money";
import { DisplayMoney } from "./display-currency";
import { frozenBreakdown } from "./overview-model";

/** Frozen balance by group (Freelancer / Investments / Deposits / Other): amount and share. */
export function FrozenBreakdownCard({ balances, className }: { balances: BalanceSheet; className?: string }) {
  const breakdown = frozenBreakdown(balances);
  // Groups that hold nothing are left out (a fresh install shows one quiet line instead).
  const groups = breakdown.groups.filter((g) => g.totalUah !== 0 || g.incomplete);
  return (
    <SectionCard
      id="frozen"
      className={className}
      title="Frozen balance"
      action={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/accounts">Accounts</Link>
        </Button>
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing set aside yet.</p>
      ) : (
        <ul aria-label="Frozen balance by group" className="flex flex-col divide-y">
          {groups.map((g) => (
            <li key={g.group} data-testid={`frozen-group-${g.group}`} className="flex items-baseline justify-between gap-3 py-2.5 first:pt-0">
              <span className="min-w-0 truncate text-sm">
                {g.label}
                {g.incomplete ? <span className="text-xs text-warning"> · partial</span> : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <DisplayMoney amountUah={g.totalUah} className="text-sm font-medium" />
                <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                  {g.displayShare === null ? "—" : formatPercent(g.displayShare)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
