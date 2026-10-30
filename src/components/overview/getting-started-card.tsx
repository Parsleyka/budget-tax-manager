import Link from "next/link";
import { AdjustBalanceDialog } from "@/components/forms/adjust-balance-dialog";
import { Button } from "@/components/ui/button";
import type { FormOptions } from "@/server/queries";

/** Shown on a fresh install (no movements and no balances yet). */
export function GettingStartedCard({ options }: { options: FormOptions }) {
  return (
    <section data-testid="getting-started" aria-label="Getting started" className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-medium">Start with today’s balances</h2>
      <div className="flex gap-2">
        <AdjustBalanceDialog
          options={options}
          accountId={options.defaultActiveAccountId}
          trigger={<Button size="sm">Enter current balance</Button>}
        />
        <Button size="sm" variant="ghost" asChild>
          <Link href="/accounts">Accounts</Link>
        </Button>
      </div>
    </section>
  );
}
