import { SkeletonCards, SkeletonHeading, SkeletonPage } from "@/components/ui/Skeleton";

// A saved view renders board/table/calendar/agenda layouts; a card grid is the
// most representative placeholder, in the view page's wider column.
export default function Loading() {
  return (
    <SkeletonPage wide>
      <SkeletonHeading />
      <SkeletonCards count={6} className="mt-6" />
    </SkeletonPage>
  );
}
