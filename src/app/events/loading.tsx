import { SkeletonBlock, SkeletonHeading, SkeletonPage, SkeletonRows } from "@/components/ui/Skeleton";

// Events: heading, the event list, then the "From your calendar" feed section.
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonRows count={5} className="mt-6" />
      <SkeletonBlock className="mt-8 h-4 w-36 bg-neutral-800" />
      <SkeletonRows count={3} className="mt-3" />
    </SkeletonPage>
  );
}
