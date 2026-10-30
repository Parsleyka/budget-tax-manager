import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { formatDate, formatDayMonth, formatQuarter, formatWeekday } from "@/lib/dates";
import type { DeadlineKind, TaxDeadline } from "@/lib/tax/deadlines";
import type { QuarterPaymentStatus } from "@/lib/tax/engine";
import { esvApplies } from "@/lib/tax/payments";
import { cn } from "@/lib/utils";
import { daysLabel, deadlineOutstanding, sameDeadline } from "./model";

export interface UpcomingDeadlinesProps {
  /** Upcoming deadlines (≥ today, sorted, with daysLeft). */
  deadlines: TaxDeadline[];
  /** Paid vs due of the page's year (other years' periods show no amount). */
  statuses: QuarterPaymentStatus[];
  /** The next deadline that needs action (emphasised). */
  next: TaxDeadline | null;
  /** "Include ЄСВ" on: minimum ЄСВ per quarter — its "Pay ЄСВ" deadlines show as optional with this amount. */
  optionalEsv?: Record<string, number>;
  /** How many deadlines to list. Default 3. */
  limit?: number;
}

const SHORT_LABELS: Record<DeadlineKind, string> = {
  filing: "File declaration",
  payment: "Pay single tax + levy",
  esv: "Pay ЄСВ",
};

/** The next few filing / payment deadlines as plain rows: date · what · what is still outstanding. */
export function UpcomingDeadlines({ deadlines: all, statuses, next, optionalEsv, limit = 3 }: UpcomingDeadlinesProps) {
  const realEsv = (period: string) => esvApplies(statuses.find((s) => s.period === period));
  const optionalAmount = (period: string) => optionalEsv?.[period] ?? 0;
  // No "Pay ЄСВ" rows for quarters with no own ЄСВ due or paid (e.g. an employer pays it) — unless the
  // optional ЄСВ is included. The loader already filters; doing it here too keeps the list right for any caller.
  const deadlines = all.filter((d) => d.kind !== "esv" || realEsv(d.period) || optionalAmount(d.period) > 0).slice(0, limit);
  return (
    <SectionCard title="Deadlines">
      {deadlines.length === 0 ? (
        <p className="py-2.5 text-sm text-muted-foreground">No upcoming deadlines</p>
      ) : (
        <ol className="divide-y text-sm">
          {deadlines.map((d) => {
            const isNext = sameDeadline(next, d.kind, d.period);
            const o = deadlineOutstanding(d, statuses);
            const optional = d.kind === "esv" && !realEsv(d.period);
            return (
              <li key={`${d.kind}-${d.period}`} className="flex items-baseline gap-3 py-2.5" aria-current={isNext ? "true" : undefined}>
                <time
                  dateTime={d.date}
                  className={cn("w-14 shrink-0 tabular-nums", isNext ? "font-medium" : "text-muted-foreground")}
                  title={`${formatWeekday(d.date)}, ${formatDate(d.date)}`}
                >
                  {formatDayMonth(d.date)}
                </time>
                <div className="min-w-0 flex-1">
                  <span className={cn(isNext && "font-medium")}>{SHORT_LABELS[d.kind]}</span>{" "}
                  <span className="text-muted-foreground">
                    {formatQuarter(d.period)}
                    {optional ? " · optional" : ""}
                    {d.daysLeft !== undefined ? ` · ${daysLabel(d.daysLeft)}` : ""}
                  </span>
                </div>
                <div className="shrink-0 text-right text-xs">
                  {optional ? (
                    <Money amount={optionalAmount(d.period)} currency="UAH" className="text-muted-foreground" />
                  ) : o === null ? null : o.outstanding > 0 ? (
                    <Money amount={o.outstanding} currency="UAH" className="font-medium" />
                  ) : o.due > 0 ? (
                    <span className="text-positive">Paid</span>
                  ) : (
                    <span className="text-muted-foreground">Nothing due</span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
