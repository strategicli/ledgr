// Server-only slots for the mail module (ADR-272 step 4): the MCP tools, which
// reach the providers and the database and so cannot sit on the pure manifest.
// Imported for effect by src/lib/modules/server-slots.ts.
import { mailModule } from "@/modules/mail/manifest";
import { mailTools } from "@/modules/mail/lib/mcp-tools";

if (mailModule.mcpTools && !mailModule.mcpTools.tools) {
  mailModule.mcpTools.tools = mailTools;
}
