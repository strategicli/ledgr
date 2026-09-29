// Server-only slots for the Website Pages module (ADR-272 step 4): the MCP
// tools (they reach the database) and the guide resource (long text, kept out
// of the client bundle). Imported for effect by src/lib/modules/server-slots.ts.
import { websitePagesModule } from "@/modules/website-pages/manifest";
import { websitePageTools } from "@/modules/website-pages/lib/mcp-tools";
import { WEBSITE_PAGES_GUIDE_URI, websitePagesGuide } from "@/modules/website-pages/lib/guide";

if (websitePagesModule.mcpTools && !websitePagesModule.mcpTools.tools) {
  websitePagesModule.mcpTools.tools = websitePageTools;
}
websitePagesModule.mcpResources ??= [
  {
    uri: WEBSITE_PAGES_GUIDE_URI,
    name: "website-pages",
    title: "Building website pages",
    description:
      "How Website Pages work: every layout block with an example, collection settings, icons, " +
      "the styles, palettes, fonts and starters with their reasoning, publishing rules, and the " +
      "MCP tools and HTTP API. Read before creating or editing a page.",
    mimeType: "text/markdown",
    read: websitePagesGuide,
  },
];
