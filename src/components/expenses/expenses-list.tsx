"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useId, useOptimistic, useState } from "react";
import { toast } from "sonner";
import { ExpenseDialog, type ExpenseDialogOptions, type ExpenseDialogProps } from "@/components/forms/expense-dialog";
import { CategoryBadge } from "@/components/shared/category-badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Money, formatMoneyDisplay } from "@/components/shared/money";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useContainerWide } from "@/hooks/use-container-wide";
import { categoryColorVar } from "@/lib/categories";
import { formatDate, formatDateRange, formatDayMonth, formatQuarter, formatWeekday, type ISODate } from "@/lib/dates";
import { TAX_KIND_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import { deleteExpense } from "@/server/actions/expenses";
import type { ExpenseRow } from "@/server/queries";
import { AddExpenseButton, notifyIfHidden } from "./add-expense-button";
import {
  DEFAULT_SORT,
  EXPENSE_SORTS,
  EXPENSE_SORT_LABELS,
  MAX_LIMIT,
  PAGE_SIZE,
  formatCount,
  groupByDay,
  isDateSort,
  pluralize,
  relativeDayLabel,
  type DayGroup,
  type DayTotal,
  type ExpenseSort,
  type ExpenseViewContext,
} from "./expense-list-model";
import { useExpensesNav } from "./expenses-nav";

export interface ExpensesListProps {
  /** The rendered page of the filtered set, already sorted (`sort`) and cut to `limit`. */
  rows: ExpenseRow[];
  /** Size of the whole filtered set. */
  total: number;
  /** UAH total of the whole filtered set. */
  totalUah: number;
  /** Full-day totals (filtered set) for the dates in `rows`. */
  dayTotals: Record<ISODate, DayTotal>;
  sort: ExpenseSort;
  limit: number;
  options: ExpenseDialogOptions;
  view: ExpenseViewContext;
  /** Category / account / search filters are active (period aside). */
  hasFilters: boolean;
  /** The period is already "All time" (no point offering it in the empty state). */
  isAllTime: boolean;
  /** Prefill for "Add spending" in the empty state. */
  addDefaults?: ExpenseDialogProps["defaults"];
}

interface RowActions {
  edit: (row: ExpenseRow) => void;
  duplicate: (row: ExpenseRow) => void;
  remove: (row: ExpenseRow) => void;
}

function describeRow(row: ExpenseRow): string {
  return `${formatMoneyDisplay(row.amount, row.currency)}, ${row.category?.name ?? "Uncategorized"}, ${formatDate(row.date)}`;
}

/**
 * The spendings list: a day-grouped (date sort) or plain (amount sort) table on wide containers and
 * day lists on phones; row actions Edit / Duplicate / Delete; "Show more"; empty states.
 * The dialogs are single instances driven by state, so rows stay light.
 */
export function ExpensesList(props: ExpensesListProps) {
  const { rows, total, totalUah, sort, limit, options, view } = props;
  const { pending, navigate } = useExpensesNav();
  const [shownSort, setShownSort] = useOptimistic(sort);
  // @2xl/expenses = 42rem: the table/cards switch point.
  const [containerRef, wide] = useContainerWide(42);

  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [copying, setCopying] = useState<ExpenseRow | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const actions: RowActions = {
    edit: (row) => {
      setEditing(row);
      setEditOpen(true);
    },
    duplicate: (row) => {
      setCopying(row);
      setCopyOpen(true);
    },
    remove: (row) => {
      setDeleting(row);
      setDeleteOpen(true);
    },
  };

  function changeSort(next: ExpenseSort) {
    navigate({ sort: next === DEFAULT_SORT ? null : next }, { keepLimit: true, optimistic: () => setShownSort(next) });
  }

  const dialogs = (
    <>
      <ExpenseDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        options={options}
        expense={editing ?? undefined}
        onSaved={(e) => notifyIfHidden(e, view)}
      />
      <ExpenseDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        options={options}
        defaults={copying ? duplicateDefaults(copying, options) : undefined}
        onSaved={(e) => notifyIfHidden(e, view)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title="Delete this spending?"
        description={
          deleting ? (
            <>
              <Money amount={deleting.amount} currency={deleting.currency} /> for {deleting.category?.name ?? "Uncategorized"} on{" "}
              {formatDate(deleting.date)}
              {deleting.note ? <> ({deleting.note})</> : null} will be removed. This can&apos;t be undone.
            </>
          ) : undefined
        }
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteExpense(deleting.id);
          if (!res.ok) {
            toast.error(res.error);
            return false;
          }
          toast.success("Spending deleted");
        }}
      >
        {deleting?.taxMeta ? (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            This is a recorded tax payment ({TAX_KIND_LABELS[deleting.taxMeta.kind]} for {formatQuarter(deleting.taxMeta.period)}).
            After deleting it, the Freelancer page counts that amount as unpaid again.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );

  // The dialogs keep the same tree position in both branches, so deleting the last row can still
  // finish (and close) its confirm dialog when the list turns into the empty state.
  if (total === 0) {
    return (
      <>
        <SectionCard>
          <EmptyResults {...props} />
        </SectionCard>
        {dialogs}
      </>
    );
  }

  const groups = isDateSort(sort) ? groupByDay(rows, props.dayTotals) : null;

  return (
    <>
      <div
        ref={containerRef}
        aria-busy={pending || undefined}
        className={cn("@container/expenses flex min-w-0 flex-col transition-opacity", pending && "opacity-60")}
      >
        <SectionCard
          title="Spendings"
          description={
            <>
              {pluralize(total, "spending")} · <Money amount={totalUah} currency="UAH" />
            </>
          }
          action={<SortSelect value={shownSort} onChange={changeSort} />}
          footer={rows.length < total ? <ShowMore shown={rows.length} total={total} limit={limit} /> : undefined}
        >
          {/* Wide containers: one table. Until measured (SSR) both layouts render and CSS picks one; then only the visible one is mounted. */}
          {wide !== false ? (
            <div className="hidden @2xl/expenses:block">
              <DesktopTable rows={rows} groups={groups} sort={sort} onSort={changeSort} actions={actions} today={options.today} />
            </div>
          ) : null}

          {/* Phones / narrow containers: day lists. */}
          {wide !== true ? (
            <div className="flex flex-col gap-4 @2xl/expenses:hidden">
              {groups ? (
                groups.map((g) => <MobileDay key={g.date} group={g} actions={actions} today={options.today} />)
              ) : (
                <ul className="divide-y">
                  {rows.map((r) => (
                    <MobileItem key={r.id} row={r} actions={actions} showDate />
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </SectionCard>
      </div>
      {dialogs}
    </>
  );
}

/** Create-mode defaults for "Duplicate": same amount/category/account/note, dated today. */
function duplicateDefaults(row: ExpenseRow, options: ExpenseDialogOptions): ExpenseDialogProps["defaults"] {
  return {
    date: options.today,
    amount: row.amount,
    note: row.note,
    // Archived ones are not selectable for new records — fall back to the dialog's defaults.
    categoryId: options.categories.some((c) => c.id === row.categoryId) ? row.categoryId : undefined,
    accountId: options.accounts.some((a) => a.id === row.accountId) ? row.accountId : undefined,
  };
}

// ------------------------------------------------------------------ toolbar bits

function SortSelect({ value, onChange }: { value: ExpenseSort; onChange: (sort: ExpenseSort) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ExpenseSort)}>
      <SelectTrigger size="sm" className="min-w-32 border-transparent text-muted-foreground shadow-none" aria-label="Sort spendings">
        <SelectValue>{EXPENSE_SORT_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        {EXPENSE_SORTS.map((s) => (
          <SelectItem key={s} value={s}>
            {EXPENSE_SORT_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ShowMore({ shown, total, limit }: { shown: number; total: number; limit: number }) {
  const { pending, navigate } = useExpensesNav();
  const remaining = total - shown;
  const canMore = remaining > 0 && limit < MAX_LIMIT;
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className="tabular-nums">
        Showing {formatCount(shown)} of {formatCount(total)}
        {!canMore ? " — narrow the filters to see the rest" : null}
      </span>
      {canMore ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-foreground"
            disabled={pending}
            onClick={() => navigate({ limit: String(limit + PAGE_SIZE) }, { keepLimit: true })}
          >
            Show {Math.min(PAGE_SIZE, remaining)} more
          </Button>
          {remaining > PAGE_SIZE && total <= MAX_LIMIT ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => navigate({ limit: String(total) })}>
              Show all
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ wide: table

function sortState(sort: ExpenseSort, key: "date" | "amount"): "ascending" | "descending" | "none" {
  if (sort === `${key}-desc`) return "descending";
  if (sort === `${key}-asc`) return "ascending";
  return "none";
}

function SortableHead({
  label,
  state,
  onClick,
  align = "left",
}: {
  label: string;
  state: "ascending" | "descending" | "none";
  onClick: () => void;
  align?: "left" | "right";
}) {
  const Icon = state === "descending" ? ArrowDown : state === "ascending" ? ArrowUp : ArrowUpDown;
  return (
    <TableHead aria-sort={state} className={cn(align === "right" && "text-right")}>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={onClick}
        className={cn("text-sm font-medium", align === "right" ? "-mr-2" : "-ml-2")}
      >
        {label}
        <Icon aria-hidden className={cn(state === "none" && "text-muted-foreground opacity-60")} />
      </Button>
    </TableHead>
  );
}

function DesktopTable({
  rows,
  groups,
  sort,
  onSort,
  actions,
  today,
}: {
  rows: ExpenseRow[];
  groups: DayGroup<ExpenseRow>[] | null;
  sort: ExpenseSort;
  onSort: (sort: ExpenseSort) => void;
  actions: RowActions;
  today: ISODate;
}) {
  const plain = !groups;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {plain ? (
            <SortableHead
              label="Date"
              state={sortState(sort, "date")}
              onClick={() => onSort(sort === "date-desc" ? "date-asc" : "date-desc")}
            />
          ) : null}
          <TableHead>Category</TableHead>
          <TableHead>Note</TableHead>
          <TableHead>Account</TableHead>
          <SortableHead
            label="Amount"
            align="right"
            state={sortState(sort, "amount")}
            onClick={() => onSort(sort === "amount-desc" ? "amount-asc" : "amount-desc")}
          />
          <TableHead className="w-10">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      {groups ? (
        groups.map((g) => (
          <TableBody key={g.date}>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="rowgroup" colSpan={3} className="h-8 pt-4 text-xs font-normal text-muted-foreground">
                <DayLabel date={g.date} today={today} />
                <span className="sr-only"> · {pluralize(g.count, "spending")}</span>
              </TableHead>
              <TableCell className="pt-4 pb-1 text-right text-xs text-muted-foreground">
                <span className="sr-only">Day total </span>
                <Money amount={g.totalUah} currency="UAH" />
              </TableCell>
              <TableCell className="py-1" />
            </TableRow>
            {g.rows.map((r) => (
              <DesktopRow key={r.id} row={r} actions={actions} />
            ))}
          </TableBody>
        ))
      ) : (
        <TableBody>
          {rows.map((r) => (
            <DesktopRow key={r.id} row={r} actions={actions} showDate />
          ))}
        </TableBody>
      )}
    </Table>
  );
}

function DesktopRow({ row, actions, showDate = false }: { row: ExpenseRow; actions: RowActions; showDate?: boolean }) {
  return (
    <TableRow>
      {showDate ? (
        <TableCell className="text-muted-foreground tabular-nums">
          <time dateTime={row.date}>{formatDate(row.date)}</time>
        </TableCell>
      ) : null}
      <TableCell>
        <CategoryBadge category={row.category} className="max-w-48" />
      </TableCell>
      <TableCell className="w-full max-w-0">
        <span className="flex min-w-0 items-center gap-2">
          {row.note ? (
            <span className="truncate" title={row.note}>
              {row.note}
            </span>
          ) : null}
          <TaxBadge row={row} />
        </span>
      </TableCell>
      <TableCell className="max-w-44 truncate text-muted-foreground">{row.account?.name ?? "Unknown account"}</TableCell>
      <TableCell className="text-right">
        <Amount row={row} />
      </TableCell>
      <TableCell className="w-10">
        <RowMenu row={row} actions={actions} />
      </TableCell>
    </TableRow>
  );
}

function Amount({ row, className }: { row: ExpenseRow; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-end leading-tight", className)}>
      <Money amount={row.amount} currency={row.currency} className="font-medium" />
      {row.currency !== "UAH" ? (
        <span className="text-xs text-muted-foreground">
          ≈ <Money amount={row.amountUah} currency="UAH" />
        </span>
      ) : null}
    </span>
  );
}

/** Marks spendings recorded via "Record tax payment" (they drive paid-vs-due on the Freelancer page). */
function TaxBadge({ row }: { row: ExpenseRow }) {
  if (!row.taxMeta) return null;
  const quarter = formatQuarter(row.taxMeta.period);
  // The default note already names the quarter ("Single tax — Q3 2026"); don't repeat it.
  const text = row.note?.includes(quarter) ? "Tax payment" : `Tax · ${quarter}`;
  return (
    <span className="shrink-0 text-xs text-muted-foreground" title={`Tax payment: ${TAX_KIND_LABELS[row.taxMeta.kind]} for ${quarter}`}>
      {text}
    </span>
  );
}

function DayLabel({ date, today }: { date: ISODate; today: ISODate }) {
  const rel = relativeDayLabel(date, today);
  return (
    <time dateTime={date} className="font-medium">
      {rel ? `${rel}, ` : `${formatWeekday(date)}, `}
      {formatDate(date)}
    </time>
  );
}

function RowMenu({ row, actions, size = "icon-sm" }: { row: ExpenseRow; actions: RowActions; size?: "icon-sm" | "icon" }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size={size} className="text-muted-foreground" aria-label={`Actions for ${describeRow(row)}`}>
          <Ellipsis aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => actions.edit(row)}>
          <Pencil aria-hidden /> Edit
        </DropdownMenuItem>
        {row.taxMeta ? null : (
          <DropdownMenuItem onSelect={() => actions.duplicate(row)}>
            <Copy aria-hidden /> Duplicate
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(row)}>
          <Trash2 aria-hidden /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ------------------------------------------------------------------ narrow: day lists

function MobileDay({ group, actions, today }: { group: DayGroup<ExpenseRow>; actions: RowActions; today: ISODate }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <header className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <h3 id={id}>
          <DayLabel date={group.date} today={today} />
        </h3>
        <span>
          <span className="sr-only">{pluralize(group.count, "spending")}, day total </span>
          <Money amount={group.totalUah} currency="UAH" />
        </span>
      </header>
      <ul className="divide-y">
        {group.rows.map((r) => (
          <MobileItem key={r.id} row={r} actions={actions} />
        ))}
      </ul>
    </section>
  );
}

function MobileItem({ row, actions, showDate = false }: { row: ExpenseRow; actions: RowActions; showDate?: boolean }) {
  const categoryName = row.category?.name ?? "Uncategorized";
  const title = row.note || categoryName;
  // In amount order the date matters most, so it leads (and never gets truncated away).
  const subtitle = [showDate ? formatDayMonth(row.date) : null, row.note ? categoryName : null, row.account?.name ?? "Unknown account"]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={() => actions.edit(row)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-3 pr-1 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: categoryColorVar(row.category?.color ?? "gray") }}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        </span>
        <Amount row={row} className="shrink-0" />
        <span className="sr-only">(edit)</span>
      </button>
      <RowMenu row={row} actions={actions} size="icon" />
    </li>
  );
}

// ------------------------------------------------------------------ empty results

function EmptyResults({ view, hasFilters, isAllTime, options, addDefaults }: ExpensesListProps) {
  const { navigate } = useExpensesNav();
  const rangeLabel = formatDateRange(view.range.from, view.range.to);
  const add = <AddExpenseButton options={options} view={view} defaults={addDefaults} size="sm" />;
  if (hasFilters) {
    return (
      <EmptyState
        variant="plain"
        title="No spendings match these filters"
        action={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => navigate({ category: null, account: null, q: null })}>
              Clear filters
            </Button>
            {add}
          </>
        }
      />
    );
  }
  return (
    <EmptyState
      variant="plain"
      title={`No spendings in ${rangeLabel}`}
      action={
        <>
          {add}
          {isAllTime ? null : (
            <Button type="button" variant="outline" size="sm" onClick={() => navigate({ period: "all", from: null, to: null })}>
              Show all time
            </Button>
          )}
        </>
      }
    />
  );
}
