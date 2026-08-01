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
// paragraph, so the marker opens a real (if loose) list. Run it on the way IN so
// bodies written before this fix heal when they load, and on the way OUT so the
// canonical markdown we store is never ambiguous for anything downstream (the
// OneDrive export, pandoc, the print/share view).
//
// Deliberately narrow: an empty item at or ABOVE the previous item's own level
// just closes that item, which parses correctly today and stays tight. Only the
// case that misparses gets the blank line.
const EMPTY_ITEM = /^( *)(?:[-+*]|\d{1,9}[.)])[ \t]*$/;
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
