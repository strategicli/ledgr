// Server-only slots for the sharing module (ADR-272 step 4): the MCP tool
// definitions, which reach the database and so cannot sit on the pure
// manifest. Imported for effect by src/lib/modules/server-slots.ts.
import { sharingModule } from "@/modules/sharing/manifest";
import { shareTools } from "@/modules/sharing/lib/mcp-tools";

if (sharingModule.mcpTools && !sharingModule.mcpTools.tools) {
  sharingModule.mcpTools.tools = shareTools;
}
