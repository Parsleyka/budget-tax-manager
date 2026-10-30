"use client";

import type * as React from "react";
import { cn } from "@/lib/utils";

/* Chart chrome (tooltip + legend) shared by the remaining charts (Investments). */

// ------------------------------------------------------------------ tooltip

/** Tooltip card: a title line, then rows where the value leads and the series label follows. */
export function TooltipCard({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="font-medium">{title}</div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

export interface TooltipRowProps {
  /** Series color for the key; omit for derived rows (totals). */
  color?: string;
  /** "line" = a short stroke (default), "none" = indent without a key. */
  keyShape?: "line" | "none";
  value: React.ReactNode;
  label: React.ReactNode;
  muted?: boolean;
}

export function TooltipRow({ color, keyShape = "line", value, label, muted }: TooltipRowProps) {
  return (
    <div className="flex items-center gap-2">
      {keyShape === "line" && color ? (
        <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      ) : (
        <span aria-hidden className="w-3 shrink-0" />
      )}
      <span className={cn("font-semibold whitespace-nowrap tabular-nums", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

// ------------------------------------------------------------------ legend

export interface LegendItem {
  label: string;
  color: string;
  /** Mirror the mark: "rect" for bars, "line" for lines. */
  shape: "rect" | "line";
}

/** Static legend (always shown for ≥ 2 series); text stays in text tokens, the swatch carries the color. */
export function ChartLegendRow({ items, className }: { items: readonly LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.shape === "rect" ? (
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: item.color }} />
          ) : (
            <span aria-hidden className="relative flex h-2.5 w-4 shrink-0 items-center">
              <span className="h-0.5 w-full rounded-full" style={{ backgroundColor: item.color }} />
              <span
                className="absolute left-1/2 size-2 -translate-x-1/2 rounded-full ring-2 ring-card"
                style={{ backgroundColor: item.color }}
              />
            </span>
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}
