"use client";

import type * as React from "react";
import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface ConfirmDialogProps {
  /** Controlled open state (optional — omit both to let `trigger` drive it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (rendered with `asChild`). */
  trigger?: React.ReactElement;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Default "Confirm" ("Delete" when `destructive`). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button. */
  destructive?: boolean;
  /**
   * Runs inside a transition (the confirm button shows a spinner and the dialog stays open meanwhile).
   * Return `false` to keep the dialog open (e.g. the action failed); anything else closes it.
   */
  onConfirm: () => void | boolean | Promise<void | boolean>;
  /** Extra content between the description and the buttons. */
  children?: React.ReactNode;
}

/** Confirmation dialog (shadcn AlertDialog) with async confirm + pending state. */
export function ConfirmDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const [pending, startTransition] = useTransition();

  function setOpen(next: boolean) {
    if (pending && !next) return;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  }

  function confirm() {
    startTransition(async () => {
      const result = await onConfirm();
      if (result !== false) setOpen(false);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <Button type="button" variant={destructive ? "destructive" : "default"} onClick={confirm} disabled={pending}>
            {pending ? <Spinner /> : null}
            {confirmLabel ?? (destructive ? "Delete" : "Confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
