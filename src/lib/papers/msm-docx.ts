// Markdown → Midwestern Style Manual (4th ed.) .docx (Papers module, P2). A
// faithful port of the proven CLI renderer at ty-docs/msm-render.js — same MSM
// layout (title page, 12pt TNR double-spaced body, 0.5" first-line indents,
// centered bold/plain subheadings, 10pt single-spaced footnotes, block quotes,
// hanging-indent bibliography, centered-bottom page numbers starting at 1 on the
// first text page). Two deliberate changes from the CLI:
//   1. Title-page fields come from a `meta` object (the item's title +
//      properties), not YAML frontmatter — Ledgr is the source of those fields.
//   2. No unpack/pack footnote-id fix step: footnotes are allocated positionally
//      via FootnoteReferenceRun, so the docx library's duplicate-id bug is
//      structurally impossible (handoff doc) and the buffer is final as built.
//
// Server-only (pulls in the `docx` package). The deliverable is the canonical
// markdown body (items.body.text); the .docx is a disposable render produced on
// demand by the render-docx route — never stored as a second source (Principle:
// markdown is canonical).
import {
  AlignmentType,
  Document,
  Footer,
  FootnoteReferenceRun,
  LineRuleType,
  NumberFormat,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  TextRun,
} from "docx";
import type { PaperMeta } from "@/lib/papers/types";

const TNR = "Times New Roman";
const BODY_SZ = 24; // 12pt (half-points)
const FN_SZ = 20; // 10pt
const HALF_INCH = 720; // 0.5" in DXA
const PAGE = { width: 12240, height: 15840 }; // US Letter
const MARGIN = { top: 1440, right: 1440, bottom: 1440, left: 1440 };
const LINE_DOUBLE = 480;
const LINE_SINGLE = 240;

// Title-page gaps as blank single-spaced lines (the literal MSM reading; the one
// spot to calibrate against the 2 Timothy 100/100 benchmark — kept identical to
// the CLI's TP constants so the calibration transfers).
const TP = {
  topBlanks: 3,
  afterSchool: 7,
  afterTitle: 7,
  afterType: 1,
  afterCourse: 7,
  afterBy: 1,
  afterAuthor: 7,
  afterLocation: 1,
};

type InlineToken =
  | { text: string; bold: boolean; italic: boolean; fn?: undefined }
  | { fn: string };

type FootnoteCtx = {
  defs: Record<string, string>;
  footnotes: Record<number, { children: Paragraph[] }>;
  counter: number;
};

// Pull `[^id]: text` definition lines out of the body (with indented
// continuation lines) so the markers left behind allocate footnotes in order.
function extractFootnoteDefs(body: string): {
  defs: Record<string, string>;
  body: string;
} {
  const defs: Record<string, string> = {};
  const out: string[] = [];
  let cur: string | null = null;
  for (const line of body.split("\n")) {
    const d = line.match(/^\[\^([^\]]+)\]:\s?(.*)$/);
    if (d) {
      cur = d[1];
      defs[cur] = d[2];
      continue;
    }
    if (cur && /^(\s{2,}|\t)/.test(line) && line.trim() !== "") {
      defs[cur] += " " + line.trim();
      continue;
    }
    cur = null;
    out.push(line);
  }
  return { defs, body: out.join("\n") };
}

// string -> tokens: plain text runs (bold/italic) interleaved with footnote refs.
function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let bold = false;
  let italic = false;
  let buf = "";
  const flush = () => {
    if (buf) {
      tokens.push({ text: buf, bold, italic });
      buf = "";
    }
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[" && text[i + 1] === "^") {
      const end = text.indexOf("]", i);
      if (end !== -1) {
        flush();
        tokens.push({ fn: text.slice(i + 2, end) });
        i = end;
        continue;
      }
    }
    if (text[i] === "*" && text[i + 1] === "*") {
      flush();
      bold = !bold;
      i++;
      continue;
    }
    if (text[i] === "*") {
      flush();
      italic = !italic;
      continue;
    }
    buf += text[i];
  }
  flush();
  return tokens;
}

// Runs with no footnote allocation (footnote content, headings, title page).
function plainRuns(text: string, size = BODY_SZ, bold?: boolean): TextRun[] {
  const runs = parseInline(text)
    .filter((t): t is Extract<InlineToken, { text: string }> => t.fn === undefined && t.text !== "")
    .map(
      (t) =>
        new TextRun({
          text: t.text,
          bold: bold !== undefined ? bold : t.bold,
          italics: t.italic,
          font: TNR,
          size,
        })
    );
  return runs.length ? runs : [new TextRun({ text: "", font: TNR, size })];
}

// Runs that ALLOCATE a sequential footnote per [^id] occurrence (document
// order), so a repeat citation is a new shortened note, not a reused number.
function allocRuns(text: string, ctx: FootnoteCtx, size = BODY_SZ): (TextRun | FootnoteReferenceRun)[] {
  const runs: (TextRun | FootnoteReferenceRun)[] = [];
  for (const t of parseInline(text)) {
    if (t.fn !== undefined) {
      const def = ctx.defs[t.fn];
      if (def === undefined) continue; // marker with no definition: skip silently
      const num = ++ctx.counter;
      ctx.footnotes[num] = {
        children: [
          new Paragraph({
            spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: LINE_SINGLE },
            indent: { firstLine: HALF_INCH },
            children: plainRuns(def, FN_SZ),
          }),
        ],
      };
      runs.push(new FootnoteReferenceRun(num));
      continue;
    }
    if (t.text === "") continue;
    runs.push(new TextRun({ text: t.text, bold: t.bold, italics: t.italic, font: TNR, size }));
  }
  return runs.length ? runs : [new TextRun({ text: "", font: TNR, size })];
}

function blank(count: number): Paragraph[] {
  return Array.from(
    { length: count },
    () =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
        children: [new TextRun({ text: "", font: TNR, size: BODY_SZ })],
      })
  );
}

function titleLine(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
    children: [new TextRun({ text: (text || "").toUpperCase(), font: TNR, size: BODY_SZ })],
  });
}

function buildTitlePage(meta: PaperMeta & { title?: string }): Paragraph[] {
  const k: Paragraph[] = [];
  k.push(...blank(TP.topBlanks));
  k.push(titleLine(meta.school || "Midwestern Baptist Theological Seminary"));
  k.push(...blank(TP.afterSchool));
  k.push(titleLine(meta.title || "Untitled"));
  k.push(...blank(TP.afterTitle));
  if (meta.paper_type) {
    k.push(titleLine(meta.paper_type));
    k.push(...blank(TP.afterType));
  }
  if (meta.course) k.push(titleLine(meta.course));
  k.push(...blank(TP.afterCourse));
  k.push(titleLine("By"));
  k.push(...blank(TP.afterBy));
  k.push(titleLine(meta.author || ""));
  k.push(...blank(TP.afterAuthor));
  k.push(titleLine(meta.location || "Kansas City, Missouri"));
  if (meta.paper_date) {
    k.push(...blank(TP.afterLocation));
    k.push(titleLine(meta.paper_date));
  }
  return k;
}

function isHeading(line: string): { level: number; text: string } | null {
  const m = line.match(/^(#{1,3})\s+(.*)$/);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

function buildBody(body: string, ctx: FootnoteCtx): Paragraph[] {
  const lines = body.replace(/\r/g, "").split("\n");
  const kids: Paragraph[] = [];
  let bibMode = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const h = isHeading(line);
    if (h) {
      if (h.text.toLowerCase() === "bibliography") {
        bibMode = true;
        kids.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            pageBreakBefore: true,
            spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: LINE_DOUBLE },
            children: [new TextRun({ text: "BIBLIOGRAPHY", font: TNR, size: BODY_SZ })],
          })
        );
      } else {
        kids.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: true,
            spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: LINE_DOUBLE, after: LINE_SINGLE },
            children: plainRuns(h.text, BODY_SZ, h.level <= 2), // ##/# bold, ### plain
          })
        );
      }
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      kids.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: LINE_SINGLE, after: LINE_SINGLE },
          indent: { left: HALF_INCH },
          children: allocRuns(quote.join(" "), ctx),
        })
      );
      continue;
    }

    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith(">") && !isHeading(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (bibMode) {
      kids.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: LINE_SINGLE },
          indent: { left: HALF_INCH, hanging: HALF_INCH },
          children: allocRuns(para.join(" "), ctx),
        })
      );
    } else {
      kids.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { line: LINE_DOUBLE, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
          indent: { firstLine: HALF_INCH },
          children: allocRuns(para.join(" "), ctx),
        })
      );
    }
  }
  return kids;
}

// The render result, so callers (route, verify script) can report footnote/block
// counts without re-parsing.
export type MsmRender = { buffer: Buffer; footnoteCount: number; bodyBlocks: number };

// markdownText = the canonical paper body; meta = title-page fields (the item's
// title plus its properties). Returns the finished .docx buffer.
export async function renderMsmDocx(
  markdownText: string,
  meta: PaperMeta & { title?: string }
): Promise<MsmRender> {
  const { defs, body: cleanBody } = extractFootnoteDefs(markdownText ?? "");
  const ctx: FootnoteCtx = { defs, footnotes: {}, counter: 0 };
  const titleChildren = buildTitlePage(meta);
  const bodyChildren = buildBody(cleanBody, ctx);

  const pageFooter = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], font: TNR, size: BODY_SZ })],
      }),
    ],
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: TNR, size: BODY_SZ } } } },
    footnotes: Object.keys(ctx.footnotes).length ? ctx.footnotes : undefined,
    sections: [
      { properties: { page: { size: PAGE, margin: MARGIN } }, children: titleChildren },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: { size: PAGE, margin: MARGIN, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
        },
        footers: { default: pageFooter },
        children: bodyChildren,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return { buffer, footnoteCount: ctx.counter, bodyBlocks: bodyChildren.length };
}
