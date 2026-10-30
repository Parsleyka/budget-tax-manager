"use client";

import { Check } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CategoryBadge } from "@/components/shared/category-badge";
import { CATEGORY_ICON_COMPONENTS } from "@/components/shared/category-icon";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CATEGORY_COLORS, CATEGORY_COLOR_KEYS, CATEGORY_ICONS, categoryColorVar, isCategoryColorKey } from "@/lib/categories";
import type { Category, CategoryInput, FieldErrors } from "@/lib/types";
import { cn } from "@/lib/utils";
import { createCategory, updateCategory } from "@/server/actions/categories";
import {
  DialogForm,
  DialogFormFooter,
  FormAlert,
  FormDialog,
  errorOf,
  unmappedError,
  useControllableOpen,
  type DialogControlProps,
} from "./form-kit";

export interface CategoryDialogProps extends DialogControlProps {
  /** Edit mode (rename / recolor / icon — also allowed for Taxes). */
  category?: Category;
  defaults?: { name?: string; color?: string; icon?: string };
  onSaved?: (category: Category) => void;
}

/** Create / edit a spending category: name, palette color, curated lucide icon. */
export function CategoryDialog({ open, onOpenChange, trigger, ...rest }: CategoryDialogProps) {
  const [isOpen, setOpen] = useControllableOpen(open, onOpenChange);
  return (
    <FormDialog open={isOpen} onOpenChange={setOpen} trigger={trigger} title={rest.category ? "Edit category" : "New category"}>
      <CategoryForm {...rest} onDone={() => setOpen(false)} />
    </FormDialog>
  );
}

const SHOWN = ["name", "color", "icon"] as const;

function CategoryForm({ category, defaults, onSaved, onDone }: Omit<CategoryDialogProps, keyof DialogControlProps> & { onDone: () => void }) {
  const [name, setName] = useState(category?.name ?? defaults?.name ?? "");
  const [color, setColor] = useState(category?.color ?? defaults?.color ?? "blue");
  const [icon, setIcon] = useState<string | null>(category?.icon ?? defaults?.icon ?? "Tag");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = ["Enter a name"];
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length) return;
    const input: CategoryInput = { name: name.trim(), color, icon };
    startTransition(async () => {
      const res = category ? await updateCategory(category.id, input) : await createCategory(input);
      if (res.ok) {
        toast.success(category ? "Category updated" : "Category created");
        onSaved?.(res.data);
        onDone();
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(unmappedError(res.error, res.fieldErrors, SHOWN));
      toast.error(res.error);
    });
  }

  return (
    <DialogForm
      onSubmit={submit}
      footer={
        <DialogFormFooter pending={pending} submitLabel={category ? "Save changes" : "Create category"}>
          <CategoryBadge category={{ name: name.trim() || "Preview", color, icon: icon ?? undefined }} />
        </DialogFormFooter>
      }
    >
      <FormAlert message={formError} />
      <FieldGroup className="gap-5">
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="category-name">Name</FieldLabel>
          <Input id="category-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Pets" aria-invalid={!!errors.name || undefined} />
          <FieldError>{errorOf(errors, "name")}</FieldError>
        </Field>

        <FieldSet data-invalid={!!errors.color || undefined}>
          <FieldLegend variant="label">Color</FieldLegend>
          <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
            {CATEGORY_COLOR_KEYS.map((key) => {
              const selected = color === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={CATEGORY_COLORS[key].label}
                  title={CATEGORY_COLORS[key].label}
                  onClick={() => setColor(key)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-3 focus-visible:ring-ring/60",
                    selected && "ring-2 ring-foreground/70",
                  )}
                  style={{ backgroundColor: categoryColorVar(key) }}
                >
                  {selected ? <Check className="size-4 text-white drop-shadow" aria-hidden /> : null}
                </button>
              );
            })}
            {!isCategoryColorKey(color) ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-4 rounded-full" style={{ backgroundColor: categoryColorVar(color) }} /> custom
              </span>
            ) : null}
          </div>
          <FieldError>{errorOf(errors, "color")}</FieldError>
        </FieldSet>

        <FieldSet data-invalid={!!errors.icon || undefined}>
          <FieldLegend variant="label">Icon</FieldLegend>
          <div role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-1 sm:grid-cols-10">
            {CATEGORY_ICONS.map((name) => {
              const Icon = CATEGORY_ICON_COMPONENTS[name];
              const selected = icon === name;
              return (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={iconLabel(name)}
                  title={iconLabel(name)}
                  onClick={() => setIcon(name)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md border border-transparent text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    selected && "border-primary bg-primary/10 text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              );
            })}
          </div>
          <FieldError>{errorOf(errors, "icon")}</FieldError>
        </FieldSet>
      </FieldGroup>
    </DialogForm>
  );
}

/** "UtensilsCrossed" → "Utensils crossed", "Gamepad2" → "Gamepad 2" (readable names for the icon radios). */
function iconLabel(name: string): string {
  const words = name.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
