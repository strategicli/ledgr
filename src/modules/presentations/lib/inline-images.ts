// Offline download support (explorations/presentations.md step 4): swap every
// /files/<id> attachment src for a data URI so the downloaded HTML has no
// network dependency. Server-only (reads the DB + storage).
import { getDb } from "@/db";
import { attachments } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getStorage } from "@/lib/storage";
import { SRC_RE, findAttachmentIds } from "@/modules/presentations/lib/attachment-ids";
import type { PresentationDesign } from "@/modules/presentations/lib/design";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// ponytail: fixed total cap rather than per-deck tuning; raise if a real deck
// with lots of full-size photos needs more.
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

export async function inlineImages(ownerId: string, html: string): Promise<string> {
  const storage = getStorage();
  if (!storage) return html;

  const ids = findAttachmentIds(html);
  if (ids.length === 0) return html;

  const rows = await getDb()
    .select({
      id: attachments.id,
      storageKey: attachments.storageKey,
      contentType: attachments.contentType,
    })
    .from(attachments)
    .where(and(eq(attachments.ownerId, ownerId), inArray(attachments.id, ids)));
  const byId = new Map(rows.map((r) => [r.id.toLowerCase(), r]));

  let totalBytes = 0;
  const dataUris = new Map<string, string>();
  for (const id of ids) {
    const att = byId.get(id);
    if (!att || !/^image\//i.test(att.contentType)) continue;
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    try {
      const res = await storage.getObject(att.storageKey);
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_BYTES) continue;
      if (totalBytes + buf.byteLength > MAX_TOTAL_BYTES) continue;
      totalBytes += buf.byteLength;
      dataUris.set(id, `data:${att.contentType};base64,${Buffer.from(buf).toString("base64")}`);
    } catch {
      // leave this one's src as-is
    }
  }
  if (dataUris.size === 0) return html;

  return html.replace(SRC_RE, (whole, id: string) => {
    const uri = dataUris.get(id.toLowerCase());
    return uri ? `src="${uri}"` : whole;
  });
}

// Inline a design's logo/background image when it's a /files/<id> address
// (design.ts's IMAGE_SRC already refuses anything else, e.g. an external URL).
// Wraps each src in a throwaway <img> tag and runs it through inlineImages
// rather than teaching that function a second input shape.
export async function inlineDesignImages(
  ownerId: string,
  design: PresentationDesign
): Promise<PresentationDesign> {
  const wrap = (src: string | null) => (src ? `<img src="${src}">` : "");
  const html = wrap(design.logo.src) + wrap(design.background.image);
  if (!html) return design;
  const inlined = await inlineImages(ownerId, html);
  const srcs = [...inlined.matchAll(/src="([^"]*)"/g)].map((m) => m[1]);
  let i = 0;
  const logoSrc = design.logo.src ? srcs[i++] : design.logo.src;
  const backgroundImage = design.background.image ? srcs[i++] : design.background.image;
  return {
    ...design,
    logo: { ...design.logo, src: logoSrc },
    background: { ...design.background, image: backgroundImage },
  };
}
