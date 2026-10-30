import { Skeleton } from "@/components/ui/skeleton";

/** Investments skeleton: title, three figures, a few account rows. */
export default function InvestmentsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading investments">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="flex gap-12">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-32" />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
