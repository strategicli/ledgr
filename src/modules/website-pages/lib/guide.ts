// The Website Pages reference: served to assistants as the MCP resource
// ledgr://guide/website-pages, and the source the user manual and the /build/api
// page point to. The block list, the design choices and the starters are read
// from the same data the editor's hover help, the picker and the renderer use,
// so this page cannot drift from what the product does.
import { BLOCK_HELP, LAYOUT_SNIPPETS } from "@/lib/editor/layout-snippets";
import { NAV_ICONS } from "@/lib/nav-icons";
import { FONTS, LANGUAGES, PALETTES } from "@/modules/website-pages/lib/theme";
import { STARTERS } from "@/modules/website-pages/lib/starters";
import { ICON_ALIASES } from "@/modules/website-pages/lib/page-html";

export const WEBSITE_PAGES_GUIDE_URI = "ledgr://guide/website-pages";

export function websitePagesGuide(): string {
  const blocks = LAYOUT_SNIPPETS.map((s) => {
    const help = BLOCK_HELP[s.id];
    return `### ${help?.label ?? s.label} (\`::: ${s.id}\`)\n\n${help?.hint ?? s.hint}\n\n\`\`\`markdown\n${s.markdown.trim()}\n\`\`\``;
  }).join("\n\n");
  const chrome = ["row", "menu", "footer"].map((id) => `- **${BLOCK_HELP[id].label}** (\`::: ${id}\`): ${BLOCK_HELP[id].hint}`).join("\n");
  const languages = Object.entries(LANGUAGES)
    .map(([id, l]) => `- **${l.name}** (\`${id}\`, font \`${l.font}\`): ${l.diff} Reach for it when: ${l.when}`)
    .join("\n");
  const palettes = Object.entries(PALETTES)
    .map(([id, p]) => `- **${p.name}** (\`${id}\`): ${p.why} Light lead ${p.light.lead}, support ${p.light.support}, highlight ${p.light.hl}.`)
    .join("\n");
  const fonts = Object.entries(FONTS).map(([id, f]) => `- **${f.name}** (\`${id}\`): ${f.why}`).join("\n");
  const starters = STARTERS.map((s) => `- **${s.name}** (\`${s.id}\`, opens as ${LANGUAGES[s.design.language].name} · ${PALETTES[s.design.palette].name}): ${s.description}`).join("\n");
  const icons = Object.keys(NAV_ICONS).map((k) => `\`:${k}:\``).join(" ");

  return `# Website Pages

A Website Page is an item whose share link opens as a designed web page instead
of a document. Together with the items you publish to it, it is a small site:
the page is the home, and every published item gets its own page under the same
link, inside the same header, menu and footer. It is a module (Build → Modules,
off until switched on, needs Sharing).

Two rules hold everything together:

1. **Content and layout are markdown.** A page's body is an ordinary note laid
   out with blocks: a line \`::: name\` above the content and a line \`:::\`
   below it. Everything inside is normal markdown. The markdown is the only
   source of truth; there is no hidden layout.
2. **The look is a setting, not markdown.** Style, colors and font live on the
   page item (\`properties.design = {language, palette, font}\`) and apply to
   every page of the site. Changing the look never touches the writing.

## Making a page

- Create an item of type **Website Page**. At the top of the page: the site's
  link (Make link / View page / Copy link), then **Design** and **Pages on this
  site**.
- **Start from a starter** (Design, only while the page is empty): the page fills
  with sample sections to type over, and takes the starter's look.
- **Type \`/\`** in the page for a block (Hero, Cards, Columns, Collection,
  Timeline, Stats, Quotes, Call to action, Callout, Video or link). Each arrives
  with sample text that shows its parts. **/icon** opens an icon picker (search,
  size, grid) that inserts the code at the caret. Typing the \`:::\` lines by
  hand works exactly the same.
- In the editor, each block shows a quiet label with a one-line summary and a
  thin rail; the block holding the caret lights up in the owner's highlight
  color, nested blocks are numbered, settings read as a key / value grid, an
  unknown setting key turns amber with a "Did you mean" fix, and icon codes
  show as small tokens. Hovering a label opens a help card (settings and their
  values, Insert an example). Clicking a label edits the raw fence line.
- A block that is misspelled or unfinished never breaks the page: its content
  shows as a plain section.

## Publishing (what reaches a site)

Publishing is an explicit act. An item appears on a site only after **Publish
to** (in that item's Export & sharing section) or over the API/MCP. Tags,
types and collections only filter and order within what was published, so
tagging a note can never make it public. Each publish records a date (a
collection sorts by it) and a short address. Unpublishing, or moving the item to
Trash, takes it off the site at once; its page address stops working (within
about a minute at the edge cache). Nothing on a public page links into Ledgr
itself: an @-mention links to a Link item's address, to a published item's page
on this site, to another item's share link, or else shows as plain text.

## Blocks

${blocks}

### Site chrome and layout helpers

${chrome}

### Writing conventions every block understands

- A short line right before a block's first \`##\` heading becomes its small
  label (the eyebrow).
- \`![what goes here](placeholder)\` draws a striped stand-in picture, captioned
  with the alt text, until a real image replaces it.
- \`:name:\` draws one of Ledgr's icons in the page's colors; at the start of a
  card or column heading it becomes the heading's badge. Add a size after the
  name: \`:home:small:\`, \`:home:medium:\`, \`:home:large:\`, \`:home:xl:\`
  (these scale with the page's type) or \`:home:48:\` (exact pixels, 8 to 256).
  Icons work everywhere on a page: headings, the site name, the menu, the footer.
  Common names map onto Ledgr's set (${Object.entries(ICON_ALIASES).map(([a, k]) => `\`:${a}:\` → ${k}`).join(", ")}).
  Unknown names stay text. Available: ${icons}
- Alignment words go on a block's first line: \`::: columns center\`,
  \`::: columns split\` (first column left, middle centered, last right; on a
  phone the stacked columns go back to the left), \`::: cards center\`.
- Headings keep the level written: \`#\` is the page's headline (h1).

### Collection settings

| Setting | Values | Meaning |
|---|---|---|
| \`title\` | text | The section heading |
| \`label\` | text | The small line above it |
| \`type\` | a type key or label | Only published items of this type (plural works) |
| \`tag\` | a tag name | Only published items with this tag (case and spaces ignored) |
| \`show\` | \`6\`, \`6 newest\`, \`3 oldest\` | How many, in which order (newest by default) |
| \`layout\` | \`grid\`, \`list\`, \`hero\`, \`series\` | Cards with pictures; rows with dates; the first item as the page's opening section; a numbered row read in order (oldest first) |
| \`button\` | text | The button on a \`hero\` layout (default "Read it") |

Subpages show the item's type and date, a reading time, the first paragraph as
a lede, a drop cap in languages that have one, Previous / Next, and "Keep
reading" (up to three other published items, those sharing a tag first).

## The look

Pages follow the reader's light or dark setting; every palette has both.

### Styles (design languages)

${languages}

### Colors (palettes: lead, support, highlight)

${palettes}

### Fonts (one per page, self-hosted)

${fonts}

### Starters

${starters}

## For assistants (MCP)

- \`list_website_pages\`: every page with its link, look and published items.
- \`create_website_page\`: title, optional starter, optional look, optional body;
  shares it by default and returns the link.
- \`set_page_design\`: change any of language / palette / font.
- \`publish_to_page\` / \`unpublish_from_page\`: put an item on a site or take it off.
- \`page_design_options\`: the styles, colors, fonts and starters with their reasoning.
- Write the page body with the ordinary item tools (\`edit_item_body\`,
  \`update_item\`); the blocks above are plain markdown.

A good page from an assistant: start from the closest starter, then rewrite its
sample text with the owner's real content, keep one idea per block, and publish
the owner's existing items rather than pasting their text into the page.

## For apps (HTTP API)

With an \`api\` credential (User Settings → API credentials), see /build/api:

- \`GET /api/machine/website-pages\`: every page (link, look, published items)
  plus the design options and starters.
- \`POST /api/machine/website-pages\`: create a page \`{title, starter?, design?, body?, share?}\`.
- \`POST|DELETE /api/machine/items/<id>/publish\` with \`{pageId}\`: publish or unpublish.
- \`PATCH /api/machine/website-pages/<pageId>\` with \`{design?, starter?}\`: set the look,
  or fill an empty page from a starter.
- The page body itself is written like any item (\`PATCH /api/machine/items\`).
`;
}
