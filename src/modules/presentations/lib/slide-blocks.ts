// A slide's markdown -> simple content blocks, for the PowerPoint export
// (pptx.ts). Deliberately coarser than the player's HTML render: PowerPoint
// text boxes don't need real markdown, just heading/paragraph/bullets/quote/
// image, in source order. Pure — no DB, no React — so
// scripts/verify-presentation-export.mts can exercise it directly.

export type SlideBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "image"; src: string };

const HEADING_RE = /^ {0,3}#{1,2}\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const IMAGE_ONLY_RE = /^\s*!\[[^\]]*\]\(([^)]+)\)\s*$/;

function inline(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function slideToBlocks(md: string): SlideBlock[] {
  const lines = (md ?? "").split("\n");
  const blocks: SlideBlock[] = [];
  let bullets: string[] = [];
  let quote: string[] = [];
  let para: string[] = [];

  const flushBullets = () => {
    if (bullets.length) blocks.push({ kind: "bullets", items: bullets });
    bullets = [];
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ kind: "quote", text: quote.join(" ") });
    quote = [];
  };
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  const flushAll = () => {
    flushBullets();
    flushQuote();
    flushPara();
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushAll();
      continue;
    }
    const img = IMAGE_ONLY_RE.exec(line);
    const heading = HEADING_RE.exec(line);
    const bullet = BULLET_RE.exec(line) ?? ORDERED_RE.exec(line);
    const quoteLine = QUOTE_RE.exec(line);
    if (img) {
      flushAll();
      blocks.push({ kind: "image", src: img[1] });
    } else if (heading) {
      flushAll();
      const text = inline(heading[1]);
      if (text) blocks.push({ kind: "heading", text });
    } else if (bullet) {
      flushQuote();
      flushPara();
      const text = inline(bullet[1]);
      if (text) bullets.push(text);
    } else if (quoteLine) {
      flushBullets();
      flushPara();
      const text = inline(quoteLine[1]);
      if (text) quote.push(text);
    } else {
      flushBullets();
      flushQuote();
      const text = inline(line);
      if (text) para.push(text);
    }
  }
  flushAll();
  return blocks;
}

// A slide whose only content is one image (the player's "layout-image" case).
export function isImageOnlySlide(blocks: SlideBlock[]): boolean {
  return blocks.length === 1 && blocks[0].kind === "image";
}
