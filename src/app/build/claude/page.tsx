// Claude & MCP — STUB (ADR-063). Route + sidebar entry are real; the management
// UI surfaces what's already built (the MCP server, scheduled Claude tasks) and
// is a later phase.
import BuildStub from "@/components/build/BuildStub";

export const dynamic = "force-dynamic";

export default function ClaudeAndMcp() {
  return (
    <BuildStub title="Claude & MCP">
      Manage what Claude can see and do — the MCP server (ADR-047), scheduled
      Claude tasks (the morning briefing and weekly health check, ADR-052), and
      briefing config. This surfaces what&rsquo;s already built behind a management
      UI; sub-areas (MCP server, scheduled tasks, briefing config) expand as
      dropdowns here when wired.
    </BuildStub>
  );
}
