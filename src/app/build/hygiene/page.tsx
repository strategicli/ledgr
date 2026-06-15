// Data Hygiene — STUB (ADR-063). The route + sidebar entry are real so the
// sidebar points somewhere; the tool itself is a later phase. The Model Overview's
// "Needs attention" flags are the seed of this.
import BuildStub from "@/components/build/BuildStub";

export const dynamic = "force-dynamic";

export default function DataHygiene() {
  return (
    <BuildStub title="Data Hygiene">
      Find and clean up unused structure — types with no items, views that return
      nothing, templates never applied, orphaned relations, and properties defined
      but never filled. The Model Overview&rsquo;s &ldquo;Needs attention&rdquo;
      flags are the seed of this; the actions land here when the tool is built.
    </BuildStub>
  );
}
