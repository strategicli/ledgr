// Generates the PWA icon set (slice 16): the Ledgr mark — the mention-blue
// "L" on the dark theme background — drawn as raw RGBA pixels and encoded as
// PNG with node's zlib. Zero dependencies on purpose (CLAUDE.md rule 5); an
// icon set is not worth an image library. Re-run after changing the art:
//   node scripts/make-icons.mjs
// Writes public/icons/icon-{192,512}.png (manifest, full-bleed so the same
// art serves purpose "any" and "maskable"; the glyph sits inside the inner
// 50%, well within the maskable safe zone) and src/app/apple-icon.png (180,
// Next's apple-touch-icon convention).
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Theme tokens from globals.css / the mention chip.
const BG = [0x19, 0x19, 0x19];
const BLUE = [0x52, 0x9c, 0xca];

// --- minimal PNG encoder -----------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // raw scanlines, each prefixed with filter byte 0
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- the mark ------------------------------------------------------------

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b]) => {
    const i = (y * size + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, color) => {
    for (let y = Math.round(y0 * size); y < Math.round(y1 * size); y++)
      for (let x = Math.round(x0 * size); x < Math.round(x1 * size); x++)
        set(x, y, color);
  };
  rect(0, 0, 1, 1, BG);
  // The L: vertical bar + foot, stroke width 12% of the tile.
  rect(0.36, 0.28, 0.48, 0.72, BLUE);
  rect(0.36, 0.6, 0.66, 0.72, BLUE);
  return encodePng(size, px);
}

mkdirSync(join(root, "public", "icons"), { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(join(root, "public", "icons", `icon-${size}.png`), drawIcon(size));
}
writeFileSync(join(root, "src", "app", "apple-icon.png"), drawIcon(180));
console.log("wrote public/icons/icon-{192,512}.png and src/app/apple-icon.png");
