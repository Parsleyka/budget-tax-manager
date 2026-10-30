import type * as React from "react";
import { cn } from "@/lib/utils";
import type { StatusView, Tone } from "./model";

const TONE_CLASS: Record<Tone, string> = {
  positive: "text-positive",
  warning: "text-warning",
  negative: "text-negative",
  info: "text-muted-foreground",
  muted: "text-muted-foreground",
};

/** Paid / due / overdue as plain text — the label carries the meaning, the tone only reinforces it. */
export function StatusBadge({ status, className, ...props }: { status: StatusView; className?: string } & Omit<React.ComponentProps<"span">, "children">) {
  return (
    <span className={cn("text-xs font-medium whitespace-nowrap", TONE_CLASS[status.tone], className)} {...props}>
      {status.label}
    </span>
  );
}
