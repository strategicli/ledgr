// Verification (ADR-150): the MCP attach_file tool's pure glue — base64/data:
// URI decoding, Content-Disposition filename parsing, image detection, and the
// body-embed markdown (image → ![alt](url), other → [name](url)). Pure only (no
// DB, no network): the byte write is R2's putObject (covered by
// verify-storage-r2) and the tool dispatch harness is verify-mcp. Run:
//   npx tsx scripts/verify-mcp-attach.mts
import { existsSync, readFileSync } from "node:fs";

// Pure test — no DB, no env needed — but load .env.local when present so it runs
// the same way the DB-backed verifies do.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const {
  decodeBase64,
  filenameFromDisposition,
  isImageContentType,
  buildEmbedReference,
  embedMarkdown,
  isImageByUrl,
  basenameFromUrl,
} = await import("../src/lib/mcp/tools/attachments");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  check(name, g === w, g === w ? "" : `got ${g}, want ${w}`);
}

const enc = (s: string) =>
  typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64");
const bytesToStr = (b: Uint8Array) => String.fromCharCode(...b);

console.log("\n# base64 decode");
{
  const d = decodeBase64(enc("hello"));
  eq("bare base64 → bytes", bytesToStr(d.bytes), "hello");
  eq("bare base64 → no content type", d.contentType, undefined);
}
{
  const d = decodeBase64(`data:image/png;base64,${enc("PNGDATA")}`);
  eq("data: URI → bytes", bytesToStr(d.bytes), "PNGDATA");
  eq("data: URI → content type", d.contentType, "image/png");
}
{
  const d = decodeBase64(`data:application/pdf;base64,${enc("PDF")}`);
  eq("data: URI (pdf) → content type", d.contentType, "application/pdf");
}
{
  // Whitespace inside a base64 blob (line-wrapped payloads) is tolerated.
  const wrapped = enc("wrapped").replace(/(.)/, "$1\n ");
  eq("whitespace tolerated", bytesToStr(decodeBase64(wrapped).bytes), "wrapped");
}
{
  let threw = false;
  try {
    decodeBase64("!!!not base64!!!@@@");
  } catch {
    threw = true;
  }
  check("invalid base64 throws", threw);
}

console.log("\n# Content-Disposition filename");
eq("plain filename", filenameFromDisposition('attachment; filename="report.pdf"'), "report.pdf");
eq("unquoted filename", filenameFromDisposition("attachment; filename=chart.png"), "chart.png");
eq(
  "filename* (RFC 5987)",
  filenameFromDisposition("attachment; filename*=UTF-8''na%C3%AFve.txt"),
  "naïve.txt"
);
eq("no filename → undefined", filenameFromDisposition("inline"), undefined);
eq("null header → undefined", filenameFromDisposition(null), undefined);

console.log("\n# image detection");
check("image/png is image", isImageContentType("image/png"));
check("image/JPEG case-insensitive", isImageContentType("image/JPEG"));
check("application/pdf is not image", !isImageContentType("application/pdf"));
check("empty is not image", !isImageContentType(""));

console.log("\n# body embed reference");
eq(
  "image → inline markdown",
  buildEmbedReference("image/png", "https://cdn.example/x.png", "A chart"),
  "![A chart](https://cdn.example/x.png)",
);
eq(
  "file → link markdown",
  buildEmbedReference("application/pdf", "https://cdn.example/x.pdf", "Q3 report"),
  "[Q3 report](https://cdn.example/x.pdf)",
);
eq(
  "label brackets escaped in link",
  buildEmbedReference("application/pdf", "https://cdn.example/x.pdf", "notes [draft]"),
  "[notes \\[draft\\]](https://cdn.example/x.pdf)",
);

console.log("\n# URL basename + image-by-extension (embed_attachment path)");
eq("basename from URL", basenameFromUrl("https://cdn.example/a/b/photo.jpg"), "photo.jpg");
eq(
  "basename decodes percent-encoding",
  basenameFromUrl("https://cdn.example/x/my%20file.pdf"),
  "my file.pdf",
);
eq("basename from bare path", basenameFromUrl("/owner/id/chart.png"), "chart.png");
check("jpg URL is image", isImageByUrl("https://cdn.example/x/photo.JPG"));
check("webp URL is image", isImageByUrl("https://cdn.example/x/pic.webp"));
check("pdf URL is not image", !isImageByUrl("https://cdn.example/x/doc.pdf"));
check("extensionless URL is not image", !isImageByUrl("https://cdn.example/x/blob"));

console.log("\n# embedMarkdown (kind-driven, used by embed_attachment)");
eq(
  "image kind → inline",
  embedMarkdown(true, "https://cdn.example/x.png", "Chart"),
  "![Chart](https://cdn.example/x.png)",
);
eq(
  "file kind → link",
  embedMarkdown(false, "https://cdn.example/x.pdf", "Doc"),
  "[Doc](https://cdn.example/x.pdf)",
);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
