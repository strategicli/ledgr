// BlockNote JSON → markdown serializer (PRD §4.1, §6.1).
//
// Deliberately pure JSON-walking code with no @blocknote import: the
// OneDrive export job and Save Offline run server-side and must never load
// the editor. Markdown is the derived, color-safe export; colors and
// highlights encode as standard inline HTML (<span style>/<mark class>)
// via the single mapping table in colors.ts, so Obsidian's reading view
// (and GitHub) render them with no plugin.
//
// Unknown block types degrade to their text content rather than throwing
// (PRD §9: custom blocks export as a snapshot/placeholder, never break the
// export). Mentions export as [@Title](ledgr://item/<id>) — a stable,
// parseable URI the importer and export-time link rewriting can target.

import { highlightTag, isBlockNoteColor, textColorTag } from "@/lib/colors";

type Styles = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  textColor?: string;
  backgroundColor?: string;
};

type InlineNode = {
  type?: string;
  text?: string;
  styles?: Styles;
  href?: string;
  content?: unknown;
  props?: Record<string, unknown>;
};

type Block = {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: unknown;
};

// Escape characters that would otherwise be read as markdown/HTML syntax.
// Kept minimal so sermon prose exports clean; backslash escapes are valid
// CommonMark for all of these.
function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

function styleText(node: InlineNode): string {
  const raw = typeof node.text === "string" ? node.text : "";
  if (!raw) return "";
  const styles = node.styles ?? {};

  // Inline code can't carry nested formatting in markdown; code wins and
  // the text goes out verbatim (backticks handled by widening the fence).
  if (styles.code) {
    const fence = raw.includes("`") ? "``" : "`";
    return `${fence}${raw}${fence}`;
  }

  // Emphasis markers hug the text, so flanking whitespace moves outside
  // them (** bold ** doesn't parse; "** bold**" neither).
  const lead = raw.match(/^\s*/)?.[0] ?? "";
  const trail = raw.length > lead.length ? (raw.match(/\s*$/)?.[0] ?? "") : "";
  let out = escapeText(raw.slice(lead.length, raw.length - trail.length));
  if (!out) return raw;

  if (styles.bold) out = `**${out}**`;
  if (styles.italic) out = `*${out}*`;
  if (styles.strike) out = `~~${out}~~`;
  if (styles.underline) out = `<u>${out}</u>`;
  if (isBlockNoteColor(styles.textColor)) {
    const tag = textColorTag(styles.textColor);
    out = `${tag.open}${out}${tag.close}`;
  }
  if (isBlockNoteColor(styles.backgroundColor)) {
    const tag = highlightTag(styles.backgroundColor);
    out = `${tag.open}${out}${tag.close}`;
  }
  return `${lead}${out}${trail}`;
}

function inlineToMarkdown(content: unknown): string {
  if (typeof content === "string") return escapeText(content);
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content as InlineNode[]) {
    if (node == null || typeof node !== "object") continue;
    if (node.type === "link") {
      const label = inlineToMarkdown(node.content) || node.href || "";
      out += `[${label}](${node.href ?? ""})`;
    } else if (node.type === "mention") {
      const title =
        typeof node.props?.title === "string" && node.props.title
          ? node.props.title
          : "untitled";
      const id = typeof node.props?.itemId === "string" ? node.props.itemId : "";
      out += `[@${escapeText(title)}](ledgr://item/${id})`;
    } else if (typeof node.text === "string") {
      out += styleText(node);
    } else if (node.content !== undefined) {
      // Unknown inline wrapper: degrade to its text.
      out += inlineToMarkdown(node.content);
    }
  }
  return out;
}

// Block-level colors (whole-block text color / background) use the same
// encoding as inline runs, wrapped around the block's rendered text.
function applyBlockColors(text: string, props: Record<string, unknown>): string {
  if (!text) return text;
  let out = text;
  if (isBlockNoteColor(props.textColor)) {
    const tag = textColorTag(props.textColor);
    out = `${tag.open}${out}${tag.close}`;
  }
  if (isBlockNoteColor(props.backgroundColor)) {
    const tag = highlightTag(props.backgroundColor);
    out = `${tag.open}${out}${tag.close}`;
  }
  return out;
}

type TableCellNode = { type?: string; content?: unknown };
type TableRowNode = { cells?: unknown };

function tableToMarkdown(content: unknown): string[] {
  const rows = (content as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const rendered: string[][] = rows.map((row: TableRowNode) => {
    const cells = Array.isArray(row?.cells) ? row.cells : [];
    return cells.map((cell: TableCellNode | unknown[]) => {
      // Cells are tableCell nodes in current BlockNote; older documents
      // stored bare inline-content arrays. Take either.
      const inline =
        Array.isArray(cell) ? cell : (cell as TableCellNode)?.content;
      return inlineToMarkdown(inline).replace(/\|/g, "\\|").replace(/\n/g, " ");
    });
  });
  const width = Math.max(...rendered.map((r) => r.length));
  const pad = (r: string[]) =>
    [...r, ...Array(Math.max(0, width - r.length)).fill("")];
  const lines = [
    `| ${pad(rendered[0]).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...rendered.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
  ];
  return lines;
}

function quotePrefix(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

const INDENT = "    ";

function indent(lines: string[]): string[] {
  return lines.map((l) => (l ? INDENT + l : l));
}

function blockToLines(block: Block, listCounter: { n: number }): string[] {
  const type = block.type ?? "paragraph";
  const props = block.props ?? {};
  const text = applyBlockColors(inlineToMarkdown(block.content), props);
  const children = Array.isArray(block.children)
    ? (block.children as Block[])
    : [];

  // List items reset the numbered counter for their children, keep it for
  // siblings; every other block type breaks a numbered run.
  if (type !== "numberedListItem") listCounter.n = 0;

  switch (type) {
    case "heading": {
      const level = Math.min(Math.max(Number(props.level) || 1, 1), 6);
      return ["#".repeat(level) + " " + text, "", ...blocksToLines(children)];
    }
    case "quote":
      return [quotePrefix(text), "", ...blocksToLines(children)];
    case "codeBlock": {
      const language = typeof props.language === "string" ? props.language : "";
      const raw = inlineToMarkdownRaw(block.content);
      return ["```" + language, ...raw.split("\n"), "```", ""];
    }
    case "divider":
      return ["---", ""];
    case "bulletListItem":
      return [`- ${text}`, ...indent(blocksToLines(children)).filter(Boolean)];
    case "numberedListItem": {
      listCounter.n += 1;
      return [
        `${listCounter.n}. ${text}`,
        ...indent(blocksToLines(children)).filter(Boolean),
      ];
    }
    case "checkListItem":
      return [
        `- [${props.checked === true ? "x" : " "}] ${text}`,
        ...indent(blocksToLines(children)).filter(Boolean),
      ];
    case "image": {
      const url = typeof props.url === "string" ? props.url : "";
      const name = typeof props.name === "string" ? props.name : "";
      const caption = typeof props.caption === "string" ? props.caption : "";
      const lines = [`![${escapeText(name)}](${url})`];
      if (caption) lines.push(`*${escapeText(caption)}*`);
      return [...lines, "", ...blocksToLines(children)];
    }
    case "file":
    case "video":
    case "audio": {
      const url = typeof props.url === "string" ? props.url : "";
      const name =
        typeof props.name === "string" && props.name ? props.name : url;
      return [`[${escapeText(name)}](${url})`, "", ...blocksToLines(children)];
    }
    case "table":
      return [...tableToMarkdown(block.content), "", ...blocksToLines(children)];
    case "pageBreak":
      return [];
    case "paragraph":
    default: {
      // Unknown/custom blocks (future query views etc.) degrade to their
      // text content; an empty one exports as nothing rather than a blank.
      const lines = text ? [text, ""] : [];
      return [...lines, ...blocksToLines(children)];
    }
  }
}

// Code blocks need raw text: no escaping, no style markers.
function inlineToMarkdownRaw(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as InlineNode[])
    .map((n) => (typeof n?.text === "string" ? n.text : ""))
    .join("");
}

const LIST_TYPES = new Set([
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

function blocksToLines(blocks: Block[]): string[] {
  const out: string[] = [];
  const counter = { n: 0 };
  let inList = false;
  for (const block of blocks) {
    if (block == null || typeof block !== "object") continue;
    const isList = LIST_TYPES.has(block.type ?? "paragraph");
    // A blank line must close a list before other content, or the next
    // block parses as a lazy continuation of the last item.
    if (inList && !isList) out.push("");
    inList = isList;
    out.push(...blockToLines(block, counter));
  }
  return out;
}

// The one public entry point: a BlockNote document (items.body) in,
// markdown out. Null/empty bodies export as the empty string.
export function bodyToMarkdown(body: unknown): string {
  if (!Array.isArray(body)) return "";
  const lines = blocksToLines(body as Block[]);
  // Collapse runs of blank lines and trim the tail.
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === "" && collapsed[collapsed.length - 1] === "") continue;
    collapsed.push(line);
  }
  while (collapsed[collapsed.length - 1] === "") collapsed.pop();
  return collapsed.join("\n") + (collapsed.length ? "\n" : "");
}
