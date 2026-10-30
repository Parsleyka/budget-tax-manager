import { Plus } from "lucide-react";
import { CategoryDialog } from "@/components/forms/category-dialog";
import { CategoryBadge } from "@/components/shared/category-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Money } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SettingsPageData } from "@/server/queries";
import { CategoryRowActions } from "./category-row-actions";
import { plural } from "./import-file";

type CategoryRow = SettingsPageData["categories"][number];

/** Settings → Categories: active and archived categories with usage, add / edit / archive / delete. */
export function CategoriesSection({ categories }: { categories: CategoryRow[] }) {
  const active = categories.filter((c) => !c.category.archived);
  const archived = categories.filter((c) => c.category.archived);
  const newButton = (
    <CategoryDialog
      trigger={
        <Button size="sm" variant="outline">
          <Plus /> New category
        </Button>
      }
    />
  );

  return (
    <>
      <SectionCard id="active-categories" title="Categories" description={active.length || undefined} action={newButton}>
        {active.length ? <CategoryTable rows={active} /> : <EmptyState variant="plain" title="No active categories" />}
      </SectionCard>

      {archived.length ? (
        <SectionCard id="archived-categories" title="Archived" description={archived.length}>
          <CategoryTable rows={archived} />
        </SectionCard>
      ) : null}
    </>
  );
}

function CategoryTable({ rows }: { rows: CategoryRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Spendings</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Total spent</TableHead>
          <TableHead className="w-20">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ category, expenseCount, totalUah }) => (
          <TableRow key={category.id}>
            <TableCell className="w-full max-w-0">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <CategoryBadge category={category} className="min-w-0" />
                  {category.systemKey === "taxes" ? <span className="shrink-0 text-xs text-muted-foreground">System</span> : null}
                </span>
                <span className="text-xs text-muted-foreground sm:hidden">
                  {expenseCount ? (
                    <>
                      {plural(expenseCount, "spending")} · <Money amount={totalUah} currency="UAH" />
                    </>
                  ) : (
                    "Unused"
                  )}
                </span>
              </div>
            </TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {expenseCount ? expenseCount : <span className="text-muted-foreground">Unused</span>}
            </TableCell>
            <TableCell className="hidden text-right sm:table-cell">
              {expenseCount ? <Money amount={totalUah} currency="UAH" /> : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="w-20">
              <CategoryRowActions category={category} expenseCount={expenseCount} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
