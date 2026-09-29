// What each "/" page-block command inserts on a Website Page (ADR-284 blocks):
// the fence lines plus sample content that shows the block's parts, so the owner
// types over an example instead of remembering which line becomes what. Plain
// data, part of the body dialect's vocabulary; the page render in the Website
// Pages module decides how each block looks. Blank lines around every fence are
// the canonical shape (verify-fenced-blocks.mts).

export type LayoutSnippet = { id: string; label: string; hint: string; keywords: string[]; markdown: string };

const block = (name: string, body: string) => `::: ${name}\n\n${body.trim()}\n\n:::\n`;

export const LAYOUT_SNIPPETS: LayoutSnippet[] = [
  {
    id: "hero",
    label: "Hero",
    hint: "Opening section: eyebrow, headline, text, buttons, picture",
    keywords: ["hero", "banner", "header", "intro", "top"],
    markdown: block(
      "hero",
      `![what the picture shows](placeholder)

A short line above the headline

# Your headline goes here

One or two sentences that say who this is for and why it matters.

[Main button](https://example.com) [Second button](https://example.com)`
    ),
  },
  {
    id: "cards",
    label: "Cards",
    hint: "A row of cards; each ### starts one",
    keywords: ["cards", "features", "grid", "boxes"],
    markdown: block(
      "cards",
      `Section label

## Section title

### First card

A sentence or two about it.

### Second card

A sentence or two about it.

### Third card

A sentence or two about it.`
    ),
  },
  {
    id: "columns",
    label: "Columns",
    hint: "Side-by-side points with a dot; each ### starts one",
    keywords: ["columns", "about", "three", "points"],
    markdown: block(
      "columns",
      `Section label

### First point

A sentence about it.

### Second point

A sentence about it.

### Third point

A sentence about it.`
    ),
  },
  {
    id: "collection",
    label: "Collection",
    hint: "A list of items you publish to this page",
    keywords: ["collection", "list", "posts", "blog", "articles", "work", "grid"],
    markdown: block(
      "collection",
      `label: Section label
title: Section title
tag: your-tag
show: 6 newest
layout: grid`
    ),
  },
  {
    id: "timeline",
    label: "Timeline",
    hint: "Rows of **when** what _detail_: a history or a Now list",
    keywords: ["timeline", "history", "experience", "now", "resume"],
    markdown: block(
      "timeline",
      `## Section title

- **2026** What happened. _A short detail_
- **2024** What happened. _A short detail_`
    ),
  },
  {
    id: "stats",
    label: "Stats",
    hint: "Key facts in a row: - **Label** value",
    keywords: ["stats", "facts", "numbers", "details"],
    markdown: block("stats", `- **Started** Month Year\n- **People** How many\n- **Cost** How much`),
  },
  {
    id: "quotes",
    label: "Quotes",
    hint: "Kind words; end each quote with — who said it",
    keywords: ["quotes", "testimonials", "kind words", "reviews"],
    markdown: block("quotes", `> What someone said about this.\n>\n> — Their name`),
  },
  {
    id: "cta",
    label: "Call to action",
    hint: "A closing band with a heading, text and buttons",
    keywords: ["cta", "call", "action", "contact", "signup", "closing"],
    markdown: block(
      "cta",
      `## What should people do next?

One sentence that makes it easy to say yes.

[Main button](https://example.com)`
    ),
  },
  {
    id: "callout",
    label: "Callout",
    hint: "A tinted aside readers shouldn't miss",
    keywords: ["callout", "note", "aside", "highlight", "notice"],
    markdown: block("callout", `**Worth knowing.** A sentence readers shouldn't miss.`),
  },
  {
    id: "embed",
    label: "Video or link",
    hint: "Paste a YouTube or Vimeo link; the next line is the caption",
    keywords: ["embed", "video", "youtube", "vimeo", "link"],
    markdown: block("embed", `https://www.youtube.com/watch?v=VIDEO_ID\n\nA caption for the video`),
  },
];

// The label and one-paragraph explanation for every block: the hover help on a
// block's chip in the editor, and the block reference the MCP guide and user
// manual print. One source, so the three always say the same thing.
export const BLOCK_HELP: Record<string, { label: string; hint: string }> = {
  hero: { label: "Hero", hint: "The opening section. A short line above the heading becomes the eyebrow, the heading is the headline, paragraphs are the lede, a line of links becomes buttons (the first solid, the rest outlined), and the first picture is the art." },
  cards: { label: "Cards", hint: "A row of cards. Each ### heading starts a new card. A short line or a ## heading before the first card becomes the section's label and title. Start a card's heading with an icon like :star: to give it a badge. Write '::: cards center' to center the text." },
  columns: { label: "Columns", hint: "Side-by-side points. Each ### heading starts a column (add a fourth ### for four). Start a heading with an icon like :home: to replace the dot. Write '::: columns center' to center every column, or '::: columns split' for left, centered and right." },
  collection: { label: "Collection", hint: "Lists items you've published to this page. Lines inside set it up: title, label, type, tag, show (e.g. 6 newest, 3 oldest), layout (grid, list, hero or series) and, for hero, button. It never shows anything you haven't published." },
  topics: { label: "Topics", hint: "Every tag on your published items, with counts. Add 'exclude: featured' to leave tags out. Any other text shows beneath." },
  timeline: { label: "Timeline", hint: "Rows written as - **When** What happened. _a detail_. Good for a history, a résumé or a Now list." },
  stats: { label: "Stats", hint: "Key facts in a row, written as - **Label** value." },
  quotes: { label: "Quotes", hint: "Kind words. Each > quote is one card; end it with a line '— Who said it'." },
  cta: { label: "Call to action", hint: "A closing band: a heading, a line of text, and a line of links that become buttons." },
  callout: { label: "Callout", hint: "A tinted aside for something readers shouldn't miss." },
  embed: { label: "Video or link", hint: "Paste a YouTube or Vimeo link to play it on the page, or any other link to show it as a card. The next line is the caption." },
  row: { label: "Side by side", hint: "Put two blocks inside (with ::: fences, this one uses ::::) to show them next to each other." },
  menu: { label: "Menu", hint: "The site's menu, shown at the top of every page. One line per entry: a link, an @-mention of a published item, a #heading on this page, or plain text." },
  footer: { label: "Footer", hint: "The bottom of every page, exactly as you write it (links, icons and all). Leave it out for no footer." },
};
