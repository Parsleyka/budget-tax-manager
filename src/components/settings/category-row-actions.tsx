"use client";

import { Archive, ArchiveRestore, Ellipsis, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CategoryDialog } from "@/components/forms/category-dialog";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { archiveCategory, deleteCategory, pinCategory } from "@/server/actions/categories";
import { plural } from "./import-file";

export interface CategoryRowActionsProps {
  category: Category;
  /** Spendings that reference this category (delete is only allowed at 0). */
  expenseCount: number;
}

/** Pin / unpin (visible toggle) · a "…" menu: edit (CategoryDialog), pin, archive / restore, delete-if-unused. */
export function CategoryRowActions({ category, expenseCount }: CategoryRowActionsProps) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();
  const isTaxes = category.systemKey === "taxes";
  const deleteBlocked = isTaxes
    ? "The Taxes category records tax payments — rename it instead."
    : expenseCount > 0
      ? `Used by ${plural(expenseCount, "spending")} — archive it instead.`
      : null;

  function setPinned(pinned: boolean) {
    startTransition(async () => {
      const res = await pinCategory(category.id, pinned);
      if (!res.ok) toast.error(res.error);
      else toast.success(pinned ? `“${category.name}” pinned` : `“${category.name}” unpinned`, pinned ? { description: "Shown first in category lists." } : undefined);
    });
  }

  function setArchived(archived: boolean) {
    startTransition(async () => {
      const res = await archiveCategory(category.id, archived);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (archived) {
        toast.success(`“${category.name}” archived`, {
          description: "Hidden from pickers; existing spendings keep it.",
          action: {
            label: "Undo",
            onClick: () => {
              void archiveCategory(category.id, false).then((r) => (r.ok ? toast.success("Restored") : toast.error(r.error)));
            },
          },
        });
      } else {
        toast.success(`“${category.name}” restored`);
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      {category.archived ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={category.pinned ? `Unpin ${category.name}` : `Pin ${category.name}`}
          aria-pressed={!!category.pinned}
          title={category.pinned ? "Unpin" : "Pin to the top of category lists"}
          disabled={pending}
          onClick={() => setPinned(!category.pinned)}
          className={cn(category.pinned ? "text-primary" : "text-muted-foreground")}
        >
          <Pin className={cn(category.pinned && "fill-current")} />
        </Button>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`More actions for ${category.name}`} className="text-muted-foreground" disabled={pending}>
            {pending ? <Spinner /> : <Ellipsis />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Rename, color & icon
          </DropdownMenuItem>
          {category.archived ? null : (
            <DropdownMenuItem onSelect={() => setPinned(!category.pinned)}>
              {category.pinned ? (
                <>
                  <PinOff /> Unpin
                </>
              ) : (
                <>
                  <Pin /> Pin to top
                </>
              )}
            </DropdownMenuItem>
          )}
          {isTaxes ? null : category.archived ? (
            <DropdownMenuItem onSelect={() => setArchived(false)}>
              <ArchiveRestore /> Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setArchived(true)}>
              <Archive /> Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={!!deleteBlocked} onSelect={() => setDeleting(true)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
          {deleteBlocked ? (
            <DropdownMenuLabel className="pt-0 text-xs font-normal whitespace-normal text-muted-foreground">
              {deleteBlocked}
            </DropdownMenuLabel>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <CategoryDialog open={editing} onOpenChange={setEditing} category={category} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        destructive
        title={`Delete “${category.name}”?`}
        description="The category is not used by any spending. This can't be undone."
        onConfirm={async () => {
          const res = await deleteCategory(category.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Category deleted");
        }}
      />
    </div>
  );
}
