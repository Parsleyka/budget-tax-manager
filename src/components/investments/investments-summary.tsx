import { Money } from "@/components/shared/money";
import { StatCard, StatRow } from "@/components/shared/stat-card";
import { ageLabel, type InvestmentSummary, type InvestmentTotals } from "@/lib/investments";
import { signedPercent, STALE_DAYS } from "./format";

/** Value · deposited · gain (UAH at today's NBU rates), plus one line when a value needs updating. */
export function InvestmentsSummary({ totals, summaries }: { totals: InvestmentTotals; summaries: InvestmentSummary[] }) {
  const tracked = summaries.filter((s) => s.value !== 0 || s.netDeposited !== 0);
  const outdated = tracked.filter((s) => s.valuationAgeDays === null || s.valuationAgeDays > STALE_DAYS);
  const gainTone = totals.gainUah > 0 ? "text-positive" : totals.gainUah < 0 ? "text-negative" : undefined;
  const notes = [
    totals.incomplete ? `Excludes ${totals.missingRates.join(" & ")} — no NBU rate yet` : null,
    totals.stale ? "Converted at an older NBU rate" : null,
    ...outdated.map((s) => (s.lastValuation ? `${s.account.name} updated ${ageLabel(s.valuationAgeDays ?? 0)}` : `${s.account.name} not updated yet`)),
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-3">
      <StatRow aria-label="Investments summary">
        <StatCard label="Value" value={<Money amount={totals.valueUah} currency="UAH" tabular={false} data-testid="investments-total-value" />} />
        <StatCard
          label="Deposited"
          value={<Money amount={totals.netDepositedUah} currency="UAH" tabular={false} data-testid="investments-total-deposited" />}
        />
        <StatCard
          label="Gain"
          value={<Money amount={totals.gainUah} currency="UAH" signed tabular={false} className={gainTone} data-testid="investments-total-gain" />}
          hint={totals.returnPct !== null ? signedPercent(totals.returnPct) : null}
        />
      </StatRow>
      {notes.length ? <p className="text-xs text-warning">{notes.join(" · ")}</p> : null}
    </div>
  );
}
