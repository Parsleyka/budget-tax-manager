import { Skeleton } from "@/components/ui/skeleton";

/** Settings skeleton: title, tab bar, a couple of form sections. */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading settings">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-8 w-full rounded-lg sm:w-80" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-full sm:w-96" />
        <Skeleton className="h-9 w-full sm:w-96" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}
