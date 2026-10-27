import { Skeleton } from "@/components/ui/skeleton";

/** instant feedback while a page's data loads; the shell stays interactive */
export default function Loading() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[60vh] w-full rounded-2xl" />
    </div>
  );
}
