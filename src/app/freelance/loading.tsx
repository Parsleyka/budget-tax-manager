import { Skeleton } from "@/components/ui/skeleton";

/** Freelancer page skeleton: header + month chips, figures, tax lines, tables. */
export default function FreelanceLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading the Freelancer page">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex max-w-3xl flex-col gap-3">
          <Skeleton className="h-8 w-80 max-w-full" />
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-md" />
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-12">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-36" />
          </div>
        ))}
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 border-t pt-5">
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 4 }, (_, j) => (
            <Skeleton key={j} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
