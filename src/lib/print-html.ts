// BlockNote JSON → print-ready HTML (Save Offline, PRD §4.7).
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

// A BlockNote document (items.body) in, body HTML out (no wrapper page).
export function bodyToHtml(body: unknown): string {
  if (!Array.isArray(body)) return "";
  return blocksToHtml(body as Block[]);
}

// The self-contained document shell, shared by Save Offline's print route
// (slice 18) and public share links (slice 31). Inline CSS, no /_next chunks,
// no hydration; dark on screen (stage-friendly, app-consistent),
// black-on-white under @media print so the browser's print-to-PDF is the PDF
// leg. Because it carries its own styles it renders identically when pinned
// offline or served from a public CDN with no app context.
const HL_CSS = Object.entries(BLOCKNOTE_COLORS)
  .map(
    ([name, c]) =>
      `mark.hl-${name}{background-color:${c.background};color:#1a1a1a}`
  )
  .join("\n");

const DOC_CSS = `
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{background:#0a0a0a;color:#e5e5e5;font:17px/1.65 Georgia,'Times New Roman',serif;
  max-width:46rem;margin:0 auto;padding:3rem 1.5rem 6rem}
h1{font-size:1.9rem;line-height:1.25;margin-bottom:1.5rem}
h2,h3,h4,h5,h6{margin:1.6em 0 .5em;line-height:1.3}
h2{font-size:1.45rem}h3{font-size:1.2rem}h4{font-size:1.05rem}
p,ul,ol,blockquote,figure,table,pre{margin-bottom:.85em}
ul,ol{padding-left:1.5em}
li>ul,li>ol{margin-bottom:0}
li.checkitem{list-style:none;margin-left:-1.5em}
.check{display:inline-block;width:1.5em}
blockquote{border-left:3px solid #525252;padding-left:1em;color:#a3a3a3}
pre{background:#171717;border:1px solid #262626;border-radius:6px;
  padding:.75em 1em;overflow-x:auto;font-size:.85em}
code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}
p code,li code{background:#171717;border-radius:3px;padding:.1em .3em}
a{color:#7cb3ff}
.mention{color:#7cb3ff;font-weight:600}
hr{border:none;border-top:1px solid #404040;margin:1.5em 0}
img{max-width:100%;height:auto;border-radius:4px}
figcaption{font-size:.85em;color:#a3a3a3;font-style:italic;margin-top:.3em}
table{border-collapse:collapse;width:100%}
td{border:1px solid #404040;padding:.35em .6em;vertical-align:top}
.page-break{height:0}
.doc-footer{margin-top:3rem;padding-top:1rem;border-top:1px solid #262626;
  font:13px system-ui,sans-serif;color:#737373}
.print-bar{position:fixed;top:.75rem;right:.75rem}
.print-bar button{background:#262626;color:#e5e5e5;border:1px solid #404040;
  border-radius:6px;padding:.4rem .9rem;font:13px system-ui,sans-serif;cursor:pointer}
${HL_CSS}
@media print{
  :root{color-scheme:light}
  body{background:#fff;color:#111;max-width:none;padding:0;font-size:12pt}
  blockquote{border-color:#999;color:#444}
  pre{background:#f5f5f5;border-color:#ddd}
  p code,li code{background:#f5f5f5}
  a,.mention{color:#1a4d8f;text-decoration:none}
  hr{border-color:#ccc}
  td{border-color:#999}
  .doc-footer{display:none}
  .page-break{page-break-after:always}
  .print-bar{display:none}
  h2,h3,h4{page-break-after:avoid}
}
`;

// Renders one item to a complete HTML page. `footerHtml` (already escaped/safe
// markup) appends a small note below the document — used by share links to
// mark the page read-only; the print-to-PDF leg drops it (@media print).
export function renderPrintDocument(
  title: string,
  body: unknown,
  opts: { footerHtml?: string } = {}
): string {
  const safeTitle = escapeHtml(title || "Untitled");
  const footer = opts.footerHtml ? `<div class="doc-footer">${opts.footerHtml}</div>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${DOC_CSS}</style>
</head>
<body>
<div class="print-bar"><button onclick="window.print()">Print / PDF</button></div>
<h1>${safeTitle}</h1>
${bodyToHtml(body)}
${footer}
</body>
</html>`;
}
