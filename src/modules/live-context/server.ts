// Server-only slots for the live-context module (ADR-272 step 4): the MCP tool
// definitions, which reach the database and so cannot sit on the pure
// manifest. Imported for effect by src/lib/modules/server-slots.ts.
import { liveContextModule } from "@/modules/live-context/manifest";
import { contextTools } from "@/modules/live-context/lib/mcp-tools";

if (liveContextModule.mcpTools && !liveContextModule.mcpTools.tools) {
  liveContextModule.mcpTools.tools = contextTools;
}
