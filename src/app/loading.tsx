import { Skeleton } from "@/components/ui/skeleton";

/** Shown inside the shell while a page's loader runs (instant on navigation). Mirrors the flat page layout. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-40" />
      <div className="flex flex-wrap gap-x-12 gap-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 border-t pt-5">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
