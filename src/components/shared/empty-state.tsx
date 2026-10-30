import type * as React from "react";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** An icon ELEMENT (e.g. `<ReceiptText />`) — elements are serializable, so this works from Server Components too. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons / links (e.g. an `<ExpenseDialog trigger={…} />`). */
  action?: React.ReactNode;
  /**
   * "card"  — dashed border box (a whole page section is empty). Default.
   * "plain" — no border, less padding (inside a SectionCard / table body).
   */
  variant?: "card" | "plain";
  className?: string;
}

/** Empty state for fresh installs and empty filters. */
export function EmptyState({ icon, title, description, action, variant = "card", className }: EmptyStateProps) {
  return (
    <Empty
      data-slot="empty-state"
      className={cn(
        "flex-none",
        variant === "card" ? "py-12" : "gap-3 p-4 py-8 md:p-6",
        className,
      )}
    >
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent className="flex-row flex-wrap justify-center">{action}</EmptyContent> : null}
    </Empty>
  );
}
