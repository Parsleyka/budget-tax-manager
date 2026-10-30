import { categoryColorVar } from "@/lib/categories";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "./category-icon";

export type CategoryLike = Pick<Category, "name" | "color"> & Partial<Pick<Category, "icon" | "archived">>;

export interface CategoryBadgeProps {
  /** null/undefined → "Uncategorized" in gray. */
  category: CategoryLike | null | undefined;
  /**
   * "badge"  — color dot + name (tables, lists). Default.
   * "inline" — color dot + icon + name (pickers, where the icon helps scanning).
   * "dot"    — same as "badge" (legends).
   */
  variant?: "badge" | "inline" | "dot";
  /** Hide the name visually (kept for screen readers + title). */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Category label: color dot (the identity mark) + name; pickers add the lucide icon.
 * The category color is never used for text (dataviz rule) — text stays in foreground tokens.
 */
export function CategoryBadge({ category, variant = "badge", iconOnly = false, className }: CategoryBadgeProps) {
  const name = category?.name ?? "Uncategorized";
  const color = categoryColorVar(category?.color ?? "gray");
  return (
    <span
      data-slot="category-badge"
      title={category?.archived ? `${name} (archived)` : name}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-2 align-middle text-sm",
        className,
      )}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {variant === "inline" ? (
        <CategoryIcon name={category?.icon} className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      <span className={cn("truncate", iconOnly && "sr-only", category?.archived && "text-muted-foreground")}>{name}</span>
      {category?.archived && !iconOnly ? <span className="text-[0.68rem] text-muted-foreground">archived</span> : null}
    </span>
  );
}
