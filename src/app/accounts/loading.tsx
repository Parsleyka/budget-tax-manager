import { Skeleton } from "@/components/ui/skeleton";

/** Accounts skeleton: header, then the compact list. */
export default function AccountsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading accounts">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
