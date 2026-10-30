import type * as React from "react";
import { formatMonth, monthOf, type ISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { minimumEsv, minimumWage } from "@/lib/tax/rules";
import { RATE_SOURCES } from "./rule-sources";
import { SourceLink } from "./source-link";

/**
 * Plain-language explanation of ЄСВ for a ФОП who is also employed (research/tax-rules.md §4).
 * No hooks — renders in Server and Client Components alike.
 */
export function EsvExplainer({ today }: { today: ISODate }) {
  const month = monthOf(today);
  const minEsv = formatMoney(minimumEsv(month), "UAH");
  const mzp = formatMoney(minimumWage(month), "UAH");

  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed">
      <Block title="Employed ФОП: no own ЄСВ for covered months">
        <p>
          You pay no ЄСВ for yourself for any month in which an employer paid ЄСВ for you of at least the minimum
          contribution ({minEsv} in {formatMonth(month)}). This is{" "}
          <SourceLink source={RATE_SOURCES.employedExemption} /> as worded by{" "}
          <SourceLink source={RATE_SOURCES.employedExemptionAmendment} />, in force since 1 October 2025.
        </p>
        <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
          <li>
            <span className="text-foreground">Any employer qualifies</span> since 01.10.2025: a main job, a part-time
            job (сумісництво) or a Diia City resident. From 01.01.2022 to 30.09.2025 only a main place of work (or a
            Diia City gig contract) qualified — for a main-job employee the result is the same.
          </li>
          <li>
            The test is <span className="text-foreground">per month</span> and needs an actual payment by the employer.
            For a covered month you may not pay ЄСВ voluntarily.
          </li>
          <li>
            The exemption covers <span className="text-foreground">ЄСВ only</span>. The single tax and the military
            levy are still due on all freelance income.
          </li>
        </ul>
      </Block>

      <Block title="Mark a month as “not covered” when">
        <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
          <li>it is the month you were hired or dismissed and the employer paid less than the minimum;</li>
          <li>you were on unpaid leave;</li>
          <li>you work under a contract with non-fixed working hours (no top-up to the minimum);</li>
          <li>you have only a part-time job paying less than the minimum wage ({mzp} gross).</li>
        </ul>
        <p className="text-muted-foreground">
          For such a month the app charges the <span className="text-foreground">full minimum</span> ({minEsv}) — the
          literal reading of the law and the ДПС position since 2024 (ІПК 15.01.2025 No.173/ІПК). Some commentators
          argue only the difference is due; the full minimum is the safe choice. With several employers in one
          month, decide yourself whether the month is covered.
        </p>
      </Block>

      <Block title="Other rules worth knowing">
        <ul className="ml-4 list-disc space-y-1 text-muted-foreground">
          <li>
            ЄСВ is not a share of income: it is a fixed amount per month, 22% of a base of at least the minimum wage —
            also in months without any income.
          </li>
          <li>
            The registration month owes the full minimum (no pro-rata); months before the ФОП registration owe nothing.
          </li>
          <li>
            The martial-law right to skip your own ЄСВ applied from March 2022 to December 2024 only; it is suspended
            for 2025 and 2026. If you used it, turn on “I did not pay ЄСВ for 2024” above.
          </li>
          <li>
            Exemption applies to old-age or long-service pensioners and people with a disability (Law 2464-VI art. 4
            ч. 4), mobilised / contract / reservist service members, residents of occupied territory, and persons
            deprived of liberty due to the aggression — for the months it lasts: add them as “ЄСВ exempt periods”.
            For mobilised or contract service tick “Military service”: those months owe no single tax and no military
            levy either (ПКУ розд. XX підр. 10 п. 25). Use the “Exempt” mode only when it covers every month.
          </li>
          <li>Paid quarterly, by the 19th of the month after the quarter; reported once a year with the Q4 declaration.</li>
        </ul>
      </Block>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
