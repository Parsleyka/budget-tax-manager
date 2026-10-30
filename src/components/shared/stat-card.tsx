import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type * as React from "react";
import { formatPercent } from "@/lib/money";
import type { Currency } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatMoneyDisplay } from "./money";

export interface StatDelta {
  /** Signed change. Its sign picks the arrow. null → "No comparison" (e.g. previous period was 0). */
  value: number | null;
  /**
   * How `value` is printed:
   * "percent" (fraction → "+12,3%", default) · "pp" (fraction → "+5,0 pp", for rates like savings rate)
   * "money" (needs `currency` → "+1 200,00 ₴") · "number" (plain).
   */
  format?: "percent" | "pp" | "money" | "number";
  currency?: Currency;
  /** Which direction is good: "up" (income, default), "down" (spending), "none" (neutral, no color). */
  good?: "up" | "down" | "none";
  /** Trailing text. Default "vs previous period". Pass "" to hide. */
  label?: string;
}

export interface StatCardProps {
  label: React.ReactNode;
  /** The figure — usually `<Money amount currency tabular={false} />` or a string. */
  value: React.ReactNode;
  delta?: StatDelta | null;
  /** One muted line under the value (breakdown, "as of" date…). */
  hint?: React.ReactNode;
  /** "default" (text-2xl) or "hero" (text-3xl/4xl — the one headline number of a page). */
  size?: "default" | "hero";
  className?: string;
  children?: React.ReactNode;
}

const NUMBER = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });
const PP = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function sign(v: number): string {
  return v > 0 ? "+" : v < 0 ? "−" : "";
}

export function formatDeltaValue(delta: StatDelta): string {
  const v = delta.value;
  if (v === null) return "—";
  switch (delta.format ?? "percent") {
    case "money":
      return formatMoneyDisplay(v, delta.currency ?? "UAH", { signed: true });
    case "pp":
      return `${sign(v)}${PP.format(Math.abs(v) * 100)} pp`;
    case "number":
      return `${sign(v)}${NUMBER.format(Math.abs(v))}`;
    default:
      return `${sign(v)}${formatPercent(Math.abs(v))}`;
  }
}

/** "▲ +12,3% vs previous period", colored by whether the direction is good. */
export function DeltaIndicator({ delta, className }: { delta: StatDelta; className?: string }) {
  const v = delta.value;
  const good = delta.good ?? "up";
  const label = delta.label ?? "vs previous period";
  const tone =
    v === null || v === 0 || good === "none"
      ? "text-muted-foreground"
      : (v > 0) === (good === "up")
        ? "text-positive"
        : "text-negative";
  const Icon = v === null || v === 0 ? Minus : v > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1 text-xs", className)}>
      <span className={cn("inline-flex items-center gap-0.5 font-medium tabular-nums", tone)}>
        <Icon aria-hidden className="size-3.5" />
        {v === null ? "No comparison" : v === 0 ? "No change" : formatDeltaValue(delta)}
      </span>
      {label ? <span className="text-muted-foreground">{label}</span> : null}
    </span>
  );
}

/** A flat figure (label · value · optional delta / hint). No box, no icon — put several in a `StatRow`. */
export function StatCard({ label, value, delta, hint, size = "default", className, children }: StatCardProps) {
  return (
    <div data-slot="stat-card" className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "min-w-0 font-semibold tracking-tight break-words",
          size === "hero" ? "text-3xl sm:text-4xl" : "text-xl",
        )}
      >
        {value}
      </div>
      {delta ? <DeltaIndicator delta={delta} /> : null}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      {children}
    </div>
  );
}

/** A row of 2–4 flat figures (wraps to 2 columns on phones). */
export function StatRow({ children, className, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-12", className)} {...props}>
      {children}
    </section>
  );
}
