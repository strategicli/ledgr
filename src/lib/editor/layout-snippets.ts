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
