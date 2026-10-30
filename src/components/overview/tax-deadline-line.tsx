import Link from "next/link";
import { Money } from "@/components/shared/money";
import { formatDayMonth } from "@/lib/dates";
import type { TaxDeadline } from "@/lib/tax/deadlines";
import type { QuarterPaymentStatus } from "@/lib/tax/engine";
import { overdueTotal, pickNextDeadline, type OverdueItem } from "@/lib/tax/payments";
import { daysLeftText, deadlineDue, deadlineParts } from "./overview-model";

/**
 * One quiet line for the next ФОП tax deadline that needs action (like the Freelancer page,
 * `pickNextDeadline` skips payments with nothing to pay), plus a red line when taxes are overdue.
 * Both link to /freelance.
 */
export function TaxDeadlineLine({
  deadlines,
  paymentStatus,
  overdue,
}: {
  deadlines: TaxDeadline[];
  paymentStatus?: readonly QuarterPaymentStatus[] | null;
  overdue?: readonly OverdueItem[] | null;
}) {
  const next = pickNextDeadline(deadlines, paymentStatus ?? []) ?? deadlines[0];
  const due = next ? deadlineDue(next, paymentStatus) : null;
  if (!next && !overdue?.length) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      {overdue && overdue.length > 0 ? (
        <Link href="/freelance" role="alert" data-testid="overdue-taxes" className="text-negative hover:underline">
          Overdue taxes · <Money amount={overdueTotal(overdue)} currency="UAH" className="font-medium" />
        </Link>
      ) : null}
      {next ? (
        <Link href="/freelance" data-testid="next-tax-deadline" className="text-muted-foreground hover:text-foreground">
          {deadlineParts(next).action} · {deadlineParts(next).period} · <time dateTime={next.date}>{formatDayMonth(next.date)}</time>
          {next.daysLeft !== undefined ? ` · ${daysLeftText(next.daysLeft)}` : ""}
          {due && !due.settled ? (
            <>
              {" "}
              · <Money amount={due.outstanding} currency="UAH" /> to pay
            </>
          ) : null}
        </Link>
      ) : null}
    </div>
  );
}
