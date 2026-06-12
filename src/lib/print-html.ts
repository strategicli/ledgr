// BlockNote JSON → print-ready HTML (Pulpit Ready, PRD §4.7).
//
// Same discipline as the markdown serializer (markdown.ts): pure JSON
// walking, no @blocknote import, server-safe. Where markdown is the
// color-safe archival format, this is the *presentation* render: the
// /items/[id]/print route wraps it in a self-contained document (inline
// CSS, no scripts, no app chrome) that pins into the service worker's
// ledgr-pin-v1 cache and prints cleanly to PDF.
//
// All text is HTML-escaped here; the only markup in the output is what this
// file emits. Unknown block types degrade to their text content (PRD §9).

import {
  BLOCKNOTE_COLORS,
  isBlockNoteColor,
} from "@/lib/colors";

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

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styleText(node: InlineNode): string {
  const raw = typeof node.text === "string" ? node.text : "";
  if (!raw) return "";
  const styles = node.styles ?? {};
  let out = escapeHtml(raw);
  if (styles.code) return `<code>${out}</code>`;
  if (styles.bold) out = `<strong>${out}</strong>`;
  if (styles.italic) out = `<em>${out}</em>`;
  if (styles.strike) out = `<s>${out}</s>`;
  if (styles.underline) out = `<u>${out}</u>`;
  if (isBlockNoteColor(styles.textColor)) {
    out = `<span style="color:${BLOCKNOTE_COLORS[styles.textColor].text}">${out}</span>`;
  }
  if (isBlockNoteColor(styles.backgroundColor)) {
    out = `<mark class="hl-${styles.backgroundColor}">${out}</mark>`;
  }
  return out;
}

function inlineToHtml(content: unknown): string {
  if (typeof content === "string") return escapeHtml(content);
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const node of content as InlineNode[]) {
    if (node == null || typeof node !== "object") continue;
    if (node.type === "link") {
      const href = typeof node.href === "string" ? node.href : "";
      const label = inlineToHtml(node.content) || escapeHtml(href);
      out += `<a href="${escapeHtml(href)}">${label}</a>`;
    } else if (node.type === "mention") {
      // Print is a flat document: a mention renders as a styled name, not a
      // navigable link (ledgr:// URIs mean nothing on paper or offline).
      const title =
        typeof node.props?.title === "string" && node.props.title
          ? node.props.title
          : "untitled";
      out += `<span class="mention">@${escapeHtml(title)}</span>`;
    } else if (typeof node.text === "string") {
      out += styleText(node);
    } else if (node.content !== undefined) {
      out += inlineToHtml(node.content);
    }
  }
  return out;
}

function blockColorStyle(props: Record<string, unknown>): string {
  const parts: string[] = [];
  if (isBlockNoteColor(props.textColor)) {
    parts.push(`color:${BLOCKNOTE_COLORS[props.textColor].text}`);
  }
  if (isBlockNoteColor(props.backgroundColor)) {
    parts.push(
      `background-color:${BLOCKNOTE_COLORS[props.backgroundColor].background}`
    );
  }
  return parts.length ? ` style="${parts.join(";")}"` : "";
}

function inlineRaw(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as InlineNode[])
    .map((n) => (typeof n?.text === "string" ? n.text : ""))
    .join("");
}

type TableCellNode = { type?: string; content?: unknown };
type TableRowNode = { cells?: unknown };

function tableToHtml(content: unknown): string {
  const rows = (content as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const body = rows
    .map((row: TableRowNode) => {
      const cells = Array.isArray(row?.cells) ? row.cells : [];
      const tds = cells
        .map((cell: TableCellNode | unknown[]) => {
          const inline =
            Array.isArray(cell) ? cell : (cell as TableCellNode)?.content;
          return `<td>${inlineToHtml(inline)}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  return `<table>${body}</table>`;
}

const LIST_TAGS: Record<string, "ul" | "ol"> = {
  bulletListItem: "ul",
  numberedListItem: "ol",
  checkListItem: "ul",
};

function blockToHtml(block: Block): string {
  const type = block.type ?? "paragraph";
  const props = block.props ?? {};
  const text = inlineToHtml(block.content);
  const style = blockColorStyle(props);
  const children = Array.isArray(block.children)
    ? blocksToHtml(block.children as Block[])
    : "";

  switch (type) {
    case "heading": {
      // The item title owns <h1>, so block headings shift down one level,
      // clamped to <h6> (the deepest real heading tag).
      const level = Math.min(Math.max(Number(props.level) || 1, 1), 5) + 1;
      return `<h${level}${style}>${text}</h${level}>${children}`;
    }
    case "quote":
      return `<blockquote${style}>${text}</blockquote>${children}`;
    case "codeBlock":
      return `<pre><code>${escapeHtml(inlineRaw(block.content))}</code></pre>${children}`;
    case "divider":
      return "<hr>";
    case "image": {
      const url = typeof props.url === "string" ? props.url : "";
      const caption = typeof props.caption === "string" ? props.caption : "";
      const cap = caption
        ? `<figcaption>${escapeHtml(caption)}</figcaption>`
        : "";
      return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(
        typeof props.name === "string" ? props.name : ""
      )}">${cap}</figure>${children}`;
    }
    case "file":
    case "video":
    case "audio": {
      const url = typeof props.url === "string" ? props.url : "";
      const name =
        typeof props.name === "string" && props.name ? props.name : url;
      return `<p${style}><a href="${escapeHtml(url)}">${escapeHtml(name)}</a></p>${children}`;
    }
    case "table":
      return `${tableToHtml(block.content)}${children}`;
    case "pageBreak":
      return `<div class="page-break"></div>`;
    case "paragraph":
      return `${text ? `<p${style}>${text}</p>` : ""}${children}`;
    default:
      // Unknown/custom blocks degrade to their text content.
      return `${text ? `<p${style}>${text}</p>` : ""}${children}`;
  }
}

// Consecutive list items of the same kind group into one <ul>/<ol>; a check
// list item carries its checkbox glyph inline (print has no interactivity).
function blocksToHtml(blocks: Block[]): string {
  let out = "";
  let listTag: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listTag) {
      out += `</${listTag}>`;
      listTag = null;
    }
  };
  for (const block of blocks) {
    if (block == null || typeof block !== "object") continue;
    const type = block.type ?? "paragraph";
    const tag = LIST_TAGS[type];
    if (tag) {
      if (listTag !== tag) {
        closeList();
        out += `<${tag}>`;
        listTag = tag;
      }
      const text = inlineToHtml(block.content);
      const style = blockColorStyle(block.props ?? {});
      const children = Array.isArray(block.children)
        ? blocksToHtml(block.children as Block[])
        : "";
      const check =
        type === "checkListItem"
          ? `<span class="check">${block.props?.checked === true ? "☑" : "☐"}</span> `
          : "";
      const cls = type === "checkListItem" ? ` class="checkitem"` : "";
      out += `<li${cls}${style}>${check}${text}${children}</li>`;
    } else {
      closeList();
      out += blockToHtml(block);
    }
  }
  closeList();
  return out;
}

// The one public entry point: a BlockNote document (items.body) in, body
// HTML out (no wrapper page; the print route owns the document shell).
export function bodyToHtml(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return blocksToHtml(body as Block[]);
}
