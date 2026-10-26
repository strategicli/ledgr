// Empty list items and the setext trap (Brandon, 2026-08-01).
//
// An empty bullet — `- ` with nothing after it, the placeholder you leave
// yourself mid-draft — is ambiguous markdown when it sits flush under a line of
// text at a shallower indent. CommonMark won't let an EMPTY list marker
// interrupt a paragraph, so that line can't open a nested list; and a line of
// `-` right under a paragraph is a SETEXT HEADING underline. So this:
//
//     - We can be focused on this world
//         -
//         -
//
// parses as an <h2> ("We can be focused on this world" rendered at heading size)
// that swallows the empty bullets. That is the "these lines render huge and I
// can't click into them" bug; the editor (marked) and every render path
// (markdown-it) agree on it, because both follow the spec.
//
// One blank line before the empty item removes the ambiguity: it closes the
// paragraph, so the marker opens a real (if loose) list. The same blank line
// heals an indented `---` under list text (see INDENTED_RULE below). Run it on the way IN so
// bodies written before this fix heal when they load, and on the way OUT so the
// canonical markdown we store is never ambiguous for anything downstream (the
// OneDrive export, pandoc, the print/share view).
//
// Deliberately narrow: an empty item at or ABOVE the previous item's own level
// just closes that item, which parses correctly today and stays tight. Only the
// case that misparses gets the blank line.
const EMPTY_ITEM = /^( *)(?:[-+*]|\d{1,9}[.)])[ \t]*$/;
// An INDENTED dash rule (`    ---`): a horizontal rule inside a list item. The
// editor's serializer (@tiptap/markdown) emits it flush under the item's text,
// with no blank line, and that line-then-dashes shape is the same setext trap
// as the empty bullet: the sentence above becomes an <h2> on the next load
// (Brandon, 2026-09-20: a bullet in an imported seminar note grew into a heading
// after one save). Only the indented form is healed; a top-level `text\n---` is
// left alone because there the editor already writes blank lines around a
// rule, so any flush form is an import's intentional setext heading.
const INDENTED_RULE = /^ +-{3,}[ \t]*$/;
const LIST_ITEM = /^( *)(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const CODE_FENCE = /^ *(?:`{3,}|~{3,})/;
// The sentinel the editor's parse side stands in for "empty list item" — see
// hydrateEmptyListItems. Never stored: it goes in just before marked reads the
// text and comes straight back out of the parsed document.
const ZWSP = "​";

export function spaceEmptyListItems(markdown: string): string {
  if (!markdown.includes("\n")) return markdown;
  const out: string[] = [];
  let inCode = false;
  for (const line of markdown.split("\n")) {
    if (CODE_FENCE.test(line)) inCode = !inCode;
    const prev = out[out.length - 1];
    if (!inCode && prev !== undefined && prev.trim() !== "") {
      const empty = EMPTY_ITEM.exec(line);
      const prevItem = LIST_ITEM.exec(prev);
      if (empty && (!prevItem || prevItem[1].length < empty[1].length)) {
        out.push("");
      } else if (INDENTED_RULE.test(line)) {
        out.push("");
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

// The editor's own parser (marked, behind @tiptap/markdown) is stricter about
// empty items than markdown-it is: a blank line is enough to stop the setext
// misread, but an empty item that OPENS a nested list still falls out of the
// list and lands as a literal "- " paragraph, with the rest of the list broken
// off after it. There is no spelling of "empty first item" that marked reads as
// a list, so on the way into the editor we give each empty item one zero-width
// space of content — enough for marked to see a real item — and take it back out
// of the parsed document (stripSentinelText). Both halves are editor-internal:
// nothing is written to the body, so what we store stays plain CommonMark.
export function hydrateEmptyListItems(markdown: string): string {
  if (!markdown.includes("-") && !markdown.includes("*") && !markdown.includes(".")) {
    return markdown;
  }
  let inCode = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (CODE_FENCE.test(line)) inCode = !inCode;
      if (inCode || !EMPTY_ITEM.test(line)) return line;
      return `${line.replace(/[ \t]+$/, "")} ${ZWSP}`;
    })
    .join("\n");
}

// Remove the sentinel from a parsed document, leaving the truly empty paragraph
// the empty bullet is meant to hold. Walks the ProseMirror JSON in place-ish
// (returns new nodes) and drops any text node that is nothing but sentinels.
export function stripSentinelText<T>(node: T): T {
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (Array.isArray(n.content)) {
    n.content = n.content
      .filter((c) => {
        const child = c as { type?: string; text?: string };
        return !(child?.type === "text" && child.text?.replace(/​/g, "") === "");
      })
      .map((c) => stripSentinelText(c));
    if (n.content.length === 0 && n.type !== "doc") delete n.content;
  } else if (typeof n.text === "string" && n.text.includes(ZWSP)) {
    n.text = n.text.replace(/​/g, "");
  }
  return node;
}

// Sub-bullets under a numbered item nest one level too deep in the editor
// (Brandon, 2026-10-26: "Cut with four tests" in a seminar note showed True? as
// the only child and tucked Sticky?/On target?/Short? under it).
//
// Root cause is @tiptap/extension-list's own ordered-list tokenizer (node_modules,
// ordered-list/utils.ts). It strips only indent+2 columns from an item's content
// lines, then .trim()s the joined block, which removes the leftover indent from
// the FIRST line only. With our 4-space serializer (see Markdown.configure in
// MarkdownEditor.tsx), `4. Cut\n    - A\n    - B` becomes `- A\n  - B`, and B
// nests under A. Bullets are unaffected: marked's own list tokenizer reads them.
//
// So before that tokenizer reads a numbered list, shift each item's indented
// content left until its shallowest line sits exactly indent+2 deep, which is
// what the tokenizer expects. Relative depth inside the item is kept. It runs on
// the tokenizer's own input (AlignedOrderedList in extensions.ts), never on the
// whole body: a numbered list nested in a bullet reaches the tokenizer already
// dedented by marked, and marked's CommonMark rules must see the original
// indents. Editor-internal: the serializer still writes 4 spaces, so what we
// store stays plain CommonMark that markdown-it already reads correctly.
const ORDERED_ITEM = /^( *)\d+\.\s/;

export function alignOrderedItemContent(markdown: string): string {
  if (!/^ *\d+\.\s/m.test(markdown)) return markdown;
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const item = ORDERED_ITEM.exec(lines[i]);
    if (!item) continue;
    // The item's content, as the tokenizer collects it: every following line up
    // to the next numbered item, while lines stay blank or indented.
    let end = i + 1;
    while (end < lines.length && !ORDERED_ITEM.test(lines[end]) && /^(\s|$)/.test(lines[end])) end++;
    const want = item[1].length + 2;
    let min = Infinity;
    for (let j = i + 1; j < end; j++) {
      if (lines[j].trim() !== "") min = Math.min(min, lines[j].length - lines[j].trimStart().length);
    }
    const shift = min - want;
    if (shift > 0 && min !== Infinity) {
      for (let j = i + 1; j < end; j++) {
        if (lines[j].trim() !== "") lines[j] = lines[j].slice(shift);
      }
    }
    i = end - 1;
  }
  return lines.join("\n");
}
