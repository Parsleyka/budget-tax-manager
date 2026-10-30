import { Skeleton } from "@/components/ui/skeleton";

/** Income page skeleton: header + period picker, 3 figures, tabs, table. */
export default function IncomeLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading income">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="h-7 w-72 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-12">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 border-t pt-5">
        <Skeleton className="h-7 w-56" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
