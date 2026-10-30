import type * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: React.ReactNode;
  /** One or two page actions at most (a primary button + an overflow menu). Right-aligned. */
  actions?: React.ReactNode;
  /** Optional toolbar row under the title (filters: PeriodPicker, selects, search). */
  children?: React.ReactNode;
  className?: string;
}

/** Page title block. Exactly one per page, first child of the page. Renders the page's <h1>. No description. */
export function PageHeader({ title, actions, children, className }: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="min-w-0 text-xl font-semibold tracking-tight text-balance">{title}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}
