import type * as React from "react";
import { cn } from "@/lib/utils";

export interface SectionCardProps {
  title?: React.ReactNode;
  /** One short muted line next to the title — data only (a period, a count), never helper text. */
  description?: React.ReactNode;
  /** Right-hand slot (one small button or link). */
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  /** Kept for call-site compatibility: sections are always full-bleed now. */
  flush?: boolean;
  className?: string;
  contentClassName?: string;
  id?: string;
}

/**
 * A flat page section: a small title row, then content. No box — sections are separated by a hairline
 * and whitespace. Tables inside align their first/last column with the title.
 */
export function SectionCard({ title, description, action, footer, children, className, contentClassName, id }: SectionCardProps) {
  const hasHeader = title || description || action;
  return (
    <section id={id} data-slot="section-card" className={cn("flex min-w-0 flex-col gap-3 border-t pt-5", className)}>
      {hasHeader ? (
        <div className="flex min-h-8 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {title ? <h2 className="text-sm font-medium">{title}</h2> : null}
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {action ? (
            <div className="flex shrink-0 items-center gap-1 has-[>[data-variant=ghost]:last-child]:-mr-2.5">{action}</div>
          ) : null}
        </div>
      ) : null}
      <div
        className={cn(
          "min-w-0 [&_[data-slot=table]_tr>*:first-child]:pl-0 [&_[data-slot=table]_tr>*:last-child]:pr-0",
          contentClassName,
        )}
      >
        {children}
      </div>
      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </section>
  );
}
