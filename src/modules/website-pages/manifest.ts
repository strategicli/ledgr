// The Website Pages module (explorations/website-pages.md). A Website Page is an
// item whose markdown body, laid out with fenced blocks (ADR-284), shares as a
// web page instead of a document: the share route hands this type to
// renderWebPage. Pure manifest. Off by default (new personal work, ADR-272), and
// it needs sharing, since a page only reaches anyone through a share link. The
// type row ships in migration 0068; while the module is off the type is hidden
// (typeKeysOfDisabledModules), so nobody else sees it.
import { MARKDOWN_FORMAT } from "@/lib/body";
import type { ModuleManifest } from "@/lib/modules";

// The type key, declared here (not in the renderer) so the manifest stays light:
// the registry is imported on client paths, and the renderer pulls in markdown-it.
export const WEBSITE_PAGE_TYPE = "website-page";

export const websitePagesModule: ModuleManifest = {
  id: "website-pages",
  label: "Website Pages",
  description:
    "A Website Page type whose share link opens as a designed web page, laid out with blocks like ::: hero and ::: cards.",
  enabledByDefault: false,
  requires: ["sharing"],
  types: [
    {
      key: WEBSITE_PAGE_TYPE,
      label: "Website Page",
      icon: "globe",
      canonicalFormat: MARKDOWN_FORMAT,
      // The note canvas (title, body, the Share control in its footer) until a
      // page canvas with a design picker and Preview lands in slice 2.
      canvasId: "longform",
    },
  ],
  exporters: [],
  mcpTools: {
    names: [
      "list_website_pages",
      "page_design_options",
      "create_website_page",
      "set_page_design",
      "publish_to_page",
      "unpublish_from_page",
    ],
    instructions:
      "Website Pages: an item of type website-page is a site's home; its share link opens as a " +
      "designed web page. Lay pages out with markdown blocks (::: hero … :::) and set the look " +
      "with set_page_design, never in the markdown. Items reach a site only through " +
      "publish_to_page. Read ledgr://guide/website-pages before building or editing a page.",
  },
  routes: [
    "src/app/share/[token]/[slug]/route.ts",
    "src/app/api/items/[id]/publish/route.ts",
    "src/app/api/items/[id]/starter/route.ts",
    "src/app/api/machine/items/[id]/publish/route.ts",
    "src/app/api/machine/website-pages/route.ts",
    "src/app/api/machine/website-pages/[id]/route.ts",
  ],
};
