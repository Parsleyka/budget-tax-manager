"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { ChartLegendRow, TooltipCard, TooltipRow, type LegendItem } from "@/components/shared/chart-parts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatDate, formatDayMonth } from "@/lib/dates";
import type { InvestmentSeriesPoint } from "@/lib/investments";
import { formatMoney, fromMinor, toMinor } from "@/lib/money";
import type { Currency } from "@/lib/types";

const VALUE = "var(--chart-1)";
const DEPOSITED = "var(--muted-foreground)";

const config = {
  value: { label: "Value", color: VALUE },
  deposited: { label: "Deposited", color: DEPOSITED },
} satisfies ChartConfig;

/** Value vs net deposited at each value update (+ today); the gap between the lines is the gain. */
export function InvestmentChart({
  series,
  currency,
  valueLabel = "Value",
}: {
  series: InvestmentSeriesPoint[];
  currency: Currency;
  /** "Value" (brokerage) or "Balance" (bank deposit). */
  valueLabel?: string;
}) {
  const legend: LegendItem[] = [
    { label: valueLabel, color: VALUE, shape: "line" },
    { label: "Net deposited", color: DEPOSITED, shape: "line" },
  ];
  const sameYear = series.length > 0 && series[0].date.slice(0, 4) === series.at(-1)!.date.slice(0, 4);
  const last = series.at(-1);
  const desc = last
    ? `Value ${formatMoney(last.value, currency)} vs ${formatMoney(last.deposited, currency)} deposited on ${formatDate(last.date)}, over ${series.length} points.`
    : "No data";
  return (
    <div className="flex flex-col gap-2">
      <ChartLegendRow items={legend} />
      <ChartContainer config={config} className="aspect-auto h-52 w-full" initialDimension={{ width: 640, height: 208 }}>
        <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} title="Value vs deposited" desc={desc}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickMargin={8}
            minTickGap={16}
            tickFormatter={(d: string) => (sameYear ? formatDayMonth(d) : formatDate(d))}
          />
          <YAxis
            width="auto"
            tickLine={false}
            axisLine={false}
            tickCount={5}
            tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)" }}
            content={(props: TooltipContentProps) => <PointTooltip {...props} currency={currency} valueLabel={valueLabel.toLowerCase()} />}
          />
          <Line
            dataKey="deposited"
            name="Net deposited"
            type="stepAfter"
            stroke={DEPOSITED}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="value"
            name={valueLabel}
            type="linear"
            stroke={VALUE}
            strokeWidth={2}
            dot={{ r: 3.5, fill: VALUE, stroke: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: VALUE, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

function PointTooltip({ active, payload, currency, valueLabel }: TooltipContentProps & { currency: Currency; valueLabel: string }) {
  const p = active ? (payload?.[0]?.payload as InvestmentSeriesPoint | undefined) : undefined;
  if (!p) return null;
  const gain = fromMinor(toMinor(p.value) - toMinor(p.deposited));
  return (
    <TooltipCard title={formatDate(p.date)}>
      <TooltipRow color={VALUE} value={formatMoney(p.value, currency)} label={valueLabel} />
      <TooltipRow color={DEPOSITED} value={formatMoney(p.deposited, currency)} label="net deposited" />
      <TooltipRow keyShape="none" value={formatMoney(gain, currency, { signDisplay: "exceptZero" })} label="gain" muted />
    </TooltipCard>
  );
}
