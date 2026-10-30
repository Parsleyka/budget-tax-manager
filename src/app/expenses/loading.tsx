import { Skeleton } from "@/components/ui/skeleton";

/** Spendings skeleton: header + filters, three figures, "By category", then the day-grouped list. */
export default function ExpensesLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading spendings">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-7 w-full sm:w-56" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:gap-x-12">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 border-t pt-5">
        <Skeleton className="h-4 w-24" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-3 border-t pt-5">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 2 }, (_, g) => (
          <div key={g} className="flex flex-col gap-2 pt-2">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
