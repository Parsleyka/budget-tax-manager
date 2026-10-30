import { Skeleton } from "@/components/ui/skeleton";

/** Debts skeleton: title, two figures, tabs, a few rows. */
export default function DebtsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading debts">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="flex gap-12">
        <Skeleton className="h-12 w-32" />
        <Skeleton className="h-12 w-32" />
      </div>
      <Skeleton className="h-8 w-48" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
