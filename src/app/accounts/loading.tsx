import { Skeleton } from "@/components/ui/skeleton";

/** Accounts skeleton: header, then flat group sections. */
export default function AccountsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading accounts">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-8 w-36" />
      </div>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 border-t pt-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}
