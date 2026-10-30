"use client";

import { Trash2 } from "lucide-react";
import type * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActionResult } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";

export interface DeleteButtonProps {
  /** Id passed to `action`. */
  id: string;
  /**
   * A delete Server Action, e.g. `deleteExpense` from `@/server/actions/expenses`.
   * Server Actions are serializable, so a Server Component can pass it straight through.
   */
  action: (id: string) => Promise<ActionResult<unknown>>;
  /** What is deleted, lower-case ("spending", "transfer"). Builds the default title / toast. */
  noun?: string;
  title?: React.ReactNode;
  /** Default: "This can't be undone." */
  description?: React.ReactNode;
  /** Default: "<Noun> deleted". */
  successMessage?: string;
  /** "icon" (ghost icon button, default — table rows) or "button" (labelled destructive button). */
  variant?: "icon" | "button";
  /** Label for variant "button" / aria-label for "icon". Default "Delete". */
  label?: string;
  /** Full accessible name of the icon button when rows need telling apart (default: "<label> <noun>"). */
  ariaLabel?: string;
  /** Custom trigger element (overrides `variant`). */
  trigger?: React.ReactElement;
  disabled?: boolean;
  /** Tooltip explaining why it's disabled (e.g. "Used by 3 spendings — archive it instead"). */
  disabledReason?: string;
  onDeleted?: () => void;
  className?: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Delete with confirmation: confirm → call the action → toast (error keeps the dialog open). */
export function DeleteButton({
  id,
  action,
  noun = "item",
  title,
  description = "This can't be undone.",
  successMessage,
  variant = "icon",
  label = "Delete",
  ariaLabel,
  trigger,
  disabled,
  disabledReason,
  onDeleted,
  className,
}: DeleteButtonProps) {
  const button =
    trigger ??
    (variant === "icon" ? (
      <Button type="button" variant="ghost" size="icon-sm" aria-label={ariaLabel ?? `${label} ${noun}`} className={className} disabled={disabled}>
        <Trash2 />
      </Button>
    ) : (
      <Button type="button" variant="destructive" size="sm" className={className} disabled={disabled}>
        <Trash2 />
        {label}
      </Button>
    ));

  if (disabled) {
    return disabledReason ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    ) : (
      button
    );
  }

  return (
    <ConfirmDialog
      trigger={button}
      destructive
      title={title ?? `Delete this ${noun}?`}
      description={description}
      confirmLabel={label}
      onConfirm={async () => {
        const res = await action(id);
        if (!res.ok) {
          toast.error(res.error);
          return false;
        }
        toast.success(successMessage ?? `${capitalize(noun)} deleted`);
        onDeleted?.();
      }}
    />
  );
}
