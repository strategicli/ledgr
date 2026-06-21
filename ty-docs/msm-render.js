#!/usr/bin/env node
/*
 * msm-render.js — Markdown -> Midwestern Style Manual (4th ed.) .docx
 *
 * Usage:  node msm-render.js paper.md [-o paper.docx]
 *
 * Canonical source is the markdown. The .docx is a disposable render.
 * Implements MSM 4th ed.: title page, 12pt TNR double-spaced body, 0.5"
 * first-line indents, centered subheadings, 10pt single-spaced footnotes,
 * block quotes, bibliography with hanging indents, centered-bottom page
 * numbers starting at 1 on the first text page (title page unnumbered).
 *
 * Input conventions:
 *   YAML frontmatter (--- ... ---) supplies the title-page fields.
 *   ##  Heading   -> first-level subheading  (centered, bold)
 *   ### Heading   -> second-level subheading (centered, plain)
 *   A heading "Bibliography" turns on bibliography formatting (new page,
 *     hanging indents) for everything after it.
 *   > line        -> block quote (single-spaced, indented, no quote marks)
 *   [^id] in text + a "[^id]: text" line -> a real Word footnote.
 *     Each marker is its own sequentially-numbered footnote (so a repeat
 *     citation is a NEW footnote with shortened text — standard MSM).
 *     Definitions may wrap onto indented continuation lines.
 *   *italic* and **bold** inline. (Use *...* for italics, not _..._.)
 */

const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Footer, AlignmentType,
  FootnoteReferenceRun, PageNumber, LineRuleType, NumberFormat, SectionType,
} = require("docx");

const TNR = "Times New Roman";
const BODY_SZ = 24;        // 12pt
const FN_SZ = 20;          // 10pt
const HALF_INCH = 720;     // 0.5"
const PAGE = { width: 12240, height: 15840 };           // US Letter
const MARGIN = { top: 1440, right: 1440, bottom: 1440, left: 1440 };
const LINE_DOUBLE = 480;
const LINE_SINGLE = 240;

// Title-page gaps as blank single-spaced lines (literal MSM reading; the one
// area to calibrate against the 100/100 benchmark).
const TP = {
  topBlanks: 3, afterSchool: 7, afterTitle: 7, afterType: 1,
  afterCourse: 7, afterBy: 1, afterAuthor: 7, afterLocation: 1,
};

function parseFrontmatter(src) {
  const m = src.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta = {}; let body = src;
  if (m) {
    body = src.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (kv) meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body };
}

function extractFootnoteDefs(body) {
  const defs = {}; const out = []; let cur = null;
  for (const line of body.split("\n")) {
    const d = line.match(/^\[\^([^\]]+)\]:\s?(.*)$/);
    if (d) { cur = d[1]; defs[cur] = d[2]; continue; }
    if (cur && /^(\s{2,}|\t)/.test(line) && line.trim() !== "") { defs[cur] += " " + line.trim(); continue; }
    cur = null; out.push(line);
  }
  return { defs, body: out.join("\n") };
}

// string -> [{text,bold,italic} | {fn:id}]
function parseInline(text) {
  const tokens = []; let bold = false, italic = false, buf = "";
  const flush = () => { if (buf) { tokens.push({ text: buf, bold, italic }); buf = ""; } };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "[" && text[i + 1] === "^") {
      const end = text.indexOf("]", i);
      if (end !== -1) { flush(); tokens.push({ fn: text.slice(i + 2, end) }); i = end; continue; }
    }
    if (text[i] === "*" && text[i + 1] === "*") { flush(); bold = !bold; i++; continue; }
    if (text[i] === "*") { flush(); italic = !italic; continue; }
    buf += text[i];
  }
  flush();
  return tokens;
}

// Build plain runs (no footnote allocation) — for footnote content, headings, etc.
function plainRuns(text, size = BODY_SZ, bold = undefined) {
  const runs = parseInline(text).filter((t) => t.fn === undefined && t.text !== "")
    .map((t) => new TextRun({ text: t.text, bold: bold !== undefined ? bold : t.bold, italics: t.italic, font: TNR, size }));
  return runs.length ? runs : [new TextRun({ text: "", font: TNR, size })];
}

// Build runs and ALLOCATE a sequential footnote per [^id] occurrence (document order).
function allocRuns(text, ctx, size = BODY_SZ) {
  const runs = [];
  for (const t of parseInline(text)) {
    if (t.fn !== undefined) {
      const def = ctx.defs[t.fn];
      if (def === undefined) { console.warn(`! footnote [^${t.fn}] referenced but never defined`); continue; }
      const num = ++ctx.counter;
      ctx.footnotes[num] = {
        children: [new Paragraph({
          spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: LINE_SINGLE },
          indent: { firstLine: HALF_INCH },
          children: plainRuns(def, FN_SZ),
        })],
      };
      runs.push(new FootnoteReferenceRun(num));
      continue;
    }
    if (t.text === "") continue;
    runs.push(new TextRun({ text: t.text, bold: t.bold, italics: t.italic, font: TNR, size }));
  }
  return runs.length ? runs : [new TextRun({ text: "", font: TNR, size })];
}

function blank(count) {
  return Array.from({ length: count }, () => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
    children: [new TextRun({ text: "", font: TNR, size: BODY_SZ })],
  }));
}
function titleLine(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
    children: [new TextRun({ text: (text || "").toUpperCase(), font: TNR, size: BODY_SZ })],
  });
}
function buildTitlePage(meta) {
  const k = [];
  k.push(...blank(TP.topBlanks));
  k.push(titleLine(meta.school || "Midwestern Baptist Theological Seminary"));
  k.push(...blank(TP.afterSchool));
  k.push(titleLine(meta.title || "Untitled"));
  k.push(...blank(TP.afterTitle));
  if (meta.paper_type) { k.push(titleLine(meta.paper_type)); k.push(...blank(TP.afterType)); }
  if (meta.course) k.push(titleLine(meta.course));
  k.push(...blank(TP.afterCourse));
  k.push(titleLine("By"));
  k.push(...blank(TP.afterBy));
  k.push(titleLine(meta.author || ""));
  k.push(...blank(TP.afterAuthor));
  k.push(titleLine(meta.location || "Kansas City, Missouri"));
  if (meta.date) { k.push(...blank(TP.afterLocation)); k.push(titleLine(meta.date)); }
  return k;
}

function isHeading(line) {
  const m = line.match(/^(#{1,3})\s+(.*)$/);
  return m ? { level: m[1].length, text: m[2].trim() } : null;
}

function buildBody(body, ctx) {
  const lines = body.replace(/\r/g, "").split("\n");
  const kids = []; let bibMode = false; let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    const h = isHeading(line);
    if (h) {
      if (h.text.toLowerCase() === "bibliography") {
        bibMode = true;
        kids.push(new Paragraph({
          alignment: AlignmentType.CENTER, pageBreakBefore: true,
          spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: LINE_DOUBLE },
          children: [new TextRun({ text: "BIBLIOGRAPHY", font: TNR, size: BODY_SZ })],
        }));
      } else {
        kids.push(new Paragraph({
          alignment: AlignmentType.CENTER, keepNext: true,
          spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: LINE_DOUBLE, after: LINE_SINGLE },
          children: plainRuns(h.text, BODY_SZ, h.level <= 2), // ##/# bold (first-level), ### plain (second-level)
        }));
      }
      i++; continue;
    }

    if (line.startsWith(">")) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith(">")) { quote.push(lines[i].replace(/^>\s?/, "")); i++; }
      kids.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: LINE_SINGLE, after: LINE_SINGLE },
        indent: { left: HALF_INCH },
        children: allocRuns(quote.join(" "), ctx),
      }));
      continue;
    }

    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith(">") && !isHeading(lines[i])) { para.push(lines[i]); i++; }
    if (bibMode) {
      kids.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { line: LINE_SINGLE, lineRule: LineRuleType.AUTO, before: 0, after: LINE_SINGLE },
        indent: { left: HALF_INCH, hanging: HALF_INCH },
        children: allocRuns(para.join(" "), ctx),
      }));
    } else {
      kids.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { line: LINE_DOUBLE, lineRule: LineRuleType.AUTO, before: 0, after: 0 },
        indent: { firstLine: HALF_INCH },
        children: allocRuns(para.join(" "), ctx),
      }));
    }
  }
  return kids;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error("usage: node msm-render.js paper.md [-o out.docx]"); process.exit(1); }
  const input = args[0];
  const oi = args.indexOf("-o");
  const output = oi !== -1 ? args[oi + 1] : input.replace(/\.md$/i, "") + ".docx";

  const { meta, body: afterMeta } = parseFrontmatter(fs.readFileSync(input, "utf8"));
  const { defs, body: cleanBody } = extractFootnoteDefs(afterMeta);

  const ctx = { defs, footnotes: {}, counter: 0 };
  const titleChildren = buildTitlePage(meta);   // no footnotes here
  const bodyChildren = buildBody(cleanBody, ctx); // allocates footnotes in order

  const pageFooter = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], font: TNR, size: BODY_SZ })],
    })],
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

  Packer.toBuffer(doc).then((buf) => {
    fs.writeFileSync(output, buf);
    console.log(`Wrote ${output}  (${bodyChildren.length} body blocks, ${ctx.counter} footnotes)`);
  });
}

main();
