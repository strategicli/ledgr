// PowerPoint export (explorations/presentations.md export step). Builds a
// .pptx from a deck source (title + resolved design + slide markdown), one
// slide per deck slide, background/logo/title-bar drawn from the design the
// player itself renders, content as real editable text/bullets/images.
//
// pptxgenjs is loaded with a dynamic import, and only from this function, so
// it never enters a bundle that merely imports this module for its types.
import { getStorage } from "@/lib/storage";
import { getDb } from "@/db";
import { attachments } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  MARGIN_PX,
  LOGO_PX,
  TITLE_PX,
  designColors,
  inSlideList,
  type PresentationDesign,
} from "./design";
import type { DeckSlide } from "./deck";
import { inlineDesignImages } from "./inline-images";
import { slideToBlocks, isImageOnlySlide, type SlideBlock } from "./slide-blocks";

export type PptxDeckSource = { title: string; design: PresentationDesign; slides: DeckSlide[] };

// Logical stage px (player-html.ts / design.ts) -> inches on a 16:9 slide.
const STAGE_W_PX = 1600;
const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;
const PX_TO_IN = SLIDE_W_IN / STAGE_W_PX;
const px = (n: number) => n * PX_TO_IN;
const hex = (h: string) => h.replace("#", "");

// A /files/<id> address -> a data: URI, reusing the same storage read
// inline-images.ts uses for slide HTML (no second image-fetch path).
async function dataUriFor(ownerId: string, src: string): Promise<string | null> {
  const m = /^\/files\/([0-9a-f-]{36})/i.exec(src);
  if (!m) return src.startsWith("data:") ? src : null;
  const storage = getStorage();
  if (!storage) return null;
  const rows = await getDb()
    .select({ storageKey: attachments.storageKey, contentType: attachments.contentType })
    .from(attachments)
    .where(and(eq(attachments.id, m[1]), eq(attachments.ownerId, ownerId)));
  const att = rows[0];
  if (!att || !/^image\//i.test(att.contentType)) return null;
  try {
    const res = await storage.getObject(att.storageKey);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${att.contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function logoPosition(corner: string, size: number, margin: number) {
  const x = corner.includes("l") ? margin : SLIDE_W_IN - margin - size;
  const y = corner.includes("t") ? margin : SLIDE_H_IN - margin - size;
  return { x, y };
}

export async function buildPptx(ownerId: string, source: PptxDeckSource): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LEDGR_WIDE", width: SLIDE_W_IN, height: SLIDE_H_IN });
  pptx.layout = "LEDGR_WIDE";

  const design = await inlineDesignImages(ownerId, source.design);
  const colors = designColors(design);
  const bgColorHex = hex(colors.bg);
  const headingHex = hex(colors.heading);
  const textHex = hex(colors.text);

  for (let i = 0; i < source.slides.length; i++) {
    const n = i + 1;
    const raw = source.slides[i];
    const slide = pptx.addSlide();

    // Background: the design's image (already inlined above) or its solid color.
    if (design.background.image) {
      slide.background = { data: design.background.image };
    } else {
      slide.background = { color: bgColorHex };
    }
    const fullBright = inSlideList(design.background.fullBrightness, n);
    if (design.background.image && !fullBright && design.background.darken > 0) {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: SLIDE_W_IN,
        h: SLIDE_H_IN,
        fill: { color: "000000", transparency: 100 - design.background.darken },
        line: { type: "none" },
      });
    }

    // Logo.
    if (design.logo.src && !inSlideList(design.logo.skip, n)) {
      const size = px(LOGO_PX[design.logo.size]);
      const margin = px(MARGIN_PX[design.logo.margin]);
      slide.addImage({ data: design.logo.src, ...logoPosition(design.logo.corner, size, margin), w: size, h: size });
    }

    // Title bar.
    if (design.titleBar.enabled && design.titleBar.text && !inSlideList(design.titleBar.skip, n)) {
      const margin = px(MARGIN_PX[design.titleBar.margin]);
      const barH = 0.6;
      const y = design.titleBar.position === "top" ? margin : SLIDE_H_IN - margin - barH;
      slide.addText(design.titleBar.text, {
        x: margin,
        y,
        w: SLIDE_W_IN - margin * 2,
        h: barH,
        fontSize: Math.round(TITLE_PX[design.titleBar.size] * 0.7),
        bold: true,
        color: headingHex,
      });
    }

    const blocks = slideToBlocks(raw.md);
    if (isImageOnlySlide(blocks)) {
      const img = blocks[0] as Extract<SlideBlock, { kind: "image" }>;
      const data = await dataUriFor(ownerId, img.src);
      if (data) {
        slide.addImage({ data, x: 0.5, y: 0.5, w: SLIDE_W_IN - 1, h: SLIDE_H_IN - 1, sizing: { type: "contain", w: SLIDE_W_IN - 1, h: SLIDE_H_IN - 1 } });
      }
    } else {
      let y = 1.0;
      let firstHeading = true;
      for (const block of blocks) {
        if (y >= SLIDE_H_IN - 0.5) break; // ran out of room; later blocks are dropped
        if (block.kind === "heading") {
          const h = firstHeading ? 1.2 : 0.8;
          slide.addText(block.text, {
            x: 0.8, y, w: SLIDE_W_IN - 1.6, h,
            fontSize: firstHeading ? 40 : 28, bold: true, color: headingHex,
          });
          y += h + 0.1;
          firstHeading = false;
        } else if (block.kind === "bullets") {
          const items = block.items.map((text) => ({ text, options: { bullet: true, breakLine: true } }));
          const h = Math.min(0.5 * block.items.length, SLIDE_H_IN - y - 0.5);
          slide.addText(items, { x: 0.8, y, w: SLIDE_W_IN - 1.6, h, fontSize: 22, color: textHex });
          y += h + 0.2;
        } else if (block.kind === "quote") {
          slide.addText(block.text, {
            x: 1.2, y, w: SLIDE_W_IN - 2.4, h: 1,
            italic: true, align: "center", fontSize: 26, color: textHex,
          });
          y += 1.2;
        } else if (block.kind === "paragraph") {
          slide.addText(block.text, { x: 0.8, y, w: SLIDE_W_IN - 1.6, h: 0.8, fontSize: 22, color: textHex });
          y += 0.9;
        } else if (block.kind === "table") {
          // Same look as the player: header rule, thin row rules, no column lines.
          const rowH = 0.45;
          const h = Math.min(rowH * block.rows.length, SLIDE_H_IN - y - 0.5);
          const none = { type: "none" as const };
          const rows = block.rows.map((cells, r) => {
            const rule = { type: "solid" as const, pt: r === 0 ? 2 : 0.75, color: textHex };
            // [top, right, bottom, left]
            const border: [typeof rule | typeof none, typeof none, typeof rule, typeof none] = [none, none, rule, none];
            return cells.map((text) => ({ text, options: { bold: r === 0, border } }));
          });
          slide.addTable(rows, { x: 0.8, y, w: SLIDE_W_IN - 1.6, h, fontSize: 18, color: textHex });
          y += h + 0.2;
        } else if (block.kind === "image") {
          const data = await dataUriFor(ownerId, block.src);
          if (data) {
            slide.addImage({ data, x: 0.8, y, w: 4, h: 2.5 });
            y += 2.7;
          }
        }
      }
    }

    if (raw.notes) slide.addNotes(raw.notes);
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
