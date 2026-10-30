import { CircleAlert } from "lucide-react";
import { Money } from "@/components/shared/money";
import { Button } from "@/components/ui/button";
import { formatDayMonth, formatQuarter, type ISODate } from "@/lib/dates";
import { TAX_KIND_LABELS, type Account } from "@/lib/types";
import type { OverdueItem, PaymentQuarterOption } from "./model";
import { RecordTaxPaymentDialog } from "./record-tax-payment-dialog";

export interface OverdueAlertProps {
  items: OverdueItem[];
  quarters: PaymentQuarterOption[];
  accounts: Account[];
  defaultAccountId: string;
  today: ISODate;
}

/** One line: overdue tax payments (deadline passed, still outstanding) with a quick "Record payment". */
export function OverdueAlert({ items, quarters, accounts, defaultAccountId, today }: OverdueAlertProps) {
  if (items.length === 0) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-negative" data-testid="overdue-alert">
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Overdue tax payments:</span>{" "}
        {items.map((i, n) => (
          <span key={`${i.period}-${i.kind}`}>
            {n > 0 ? " · " : null}
            {TAX_KIND_LABELS[i.kind]} {formatQuarter(i.period)} <Money amount={i.outstanding} currency="UAH" /> (due{" "}
            {formatDayMonth(i.deadline)})
          </span>
        ))}
      </span>
      <RecordTaxPaymentDialog
        quarters={quarters}
        defaultPeriod={items[0].period}
        accounts={accounts}
        defaultAccountId={defaultAccountId}
        today={today}
        trigger={
          <Button size="sm" variant="ghost" className="text-negative hover:text-negative">
            Record payment
          </Button>
        }
      />
    </div>
  );
}
