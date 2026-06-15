// Import & Migration — STUB (ADR-063). Route + sidebar entry are real; the
// importer is a later phase (Phase 3 roadmap).
import BuildStub from "@/components/build/BuildStub";

export const dynamic = "force-dynamic";

export default function ImportMigration() {
  return (
    <BuildStub title="Import & Migration">
      Bring external structure into the model. First target: selective Notion
      migration (Phase 3 roadmap). Sources expand as dropdowns under this entry as
      they&rsquo;re added.
    </BuildStub>
  );
}
