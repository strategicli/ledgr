import { SkeletonCards, SkeletonHeading, SkeletonPage } from "@/components/ui/Skeleton";

// A dashboard is a grid of widgets; mirror it with a card grid in the wide column.
export default function Loading() {
  return (
    <SkeletonPage wide>
      <SkeletonHeading />
      <SkeletonCards count={6} className="mt-6" />
    </SkeletonPage>
  );
}
