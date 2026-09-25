// Server-only slots for the ai-memory module (ADR-272 step 4): the MCP tools,
// the memory-protocol resource and the search_items hook. The tools and the hook
// reach the database, so they cannot sit on the pure manifest; the resource is
// attached here too so its long text stays out of the client bundle. Imported
// for effect by src/lib/modules/server-slots.ts.
import { aiMemoryModule } from "@/modules/ai-memory/manifest";
import { memorySearchHits, memoryTools } from "@/modules/ai-memory/lib/mcp-tools";
import { MEMORY_PROTOCOL_GUIDE, MEMORY_PROTOCOL_RESOURCE } from "@/modules/ai-memory/lib/protocol";

if (aiMemoryModule.mcpTools && !aiMemoryModule.mcpTools.tools) {
  aiMemoryModule.mcpTools.tools = memoryTools;
}
aiMemoryModule.mcpResources ??= [{ ...MEMORY_PROTOCOL_RESOURCE, read: () => MEMORY_PROTOCOL_GUIDE }];
aiMemoryModule.mcpSearchHits ??= memorySearchHits;
