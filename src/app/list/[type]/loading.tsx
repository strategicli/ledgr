import { SkeletonHeading, SkeletonPage, SkeletonRows, SkeletonTabs } from "@/components/ui/Skeleton";

// A type's list page: heading, the list-lens tab strip (ADR-105), then rows.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <div className="mt-6">
        <SkeletonTabs count={5} />
      </div>
      <SkeletonRows count={8} className="mt-6" />
    </SkeletonPage>
  );
}
