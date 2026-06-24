import { SkeletonHeading, SkeletonPage, SkeletonRows, SkeletonTabs } from "@/components/ui/Skeleton";

// Tasks: heading, the four-tab strip (Today / Inbox / Upcoming / Projects), rows.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <div className="mt-6">
        <SkeletonTabs count={4} />
      </div>
      <SkeletonRows count={8} className="mt-6" />
    </SkeletonPage>
  );
}
