// Load an item's body as a rendered deck (the presentations module, step 2).
// Resolves live {{item.*}} tokens first, exactly like the print route, so a
// deck shows real titles/dates rather than raw token syntax.
//
// Step 5: a slide whose only content is one item link (soleMention) embeds
// that item's slides in its place, depth 1 only (an embedded item's own
// mentions are never expanded). A song (chordpro body) becomes one slide per
// section, lyrics only. Anything else runs through buildDeck; a manuscript
// deck drops its leading title slide, since the embedding slide is the title.
import { getItem, ItemError } from "@/lib/items";
import { resolveItemBodyTokens } from "@/lib/item-tokens-service";
import { bodyMarkdown, isItemBody } from "@/lib/body";
import { markdownToHtml } from "@/lib/markdown-render";
import { buildDeck, chordProToSlides, soleMention, type DeckSlide } from "@/modules/presentations/lib/deck";
import { parseChordPro } from "@/lib/chordpro/parse";
import { CHORDPRO_FORMAT } from "@/lib/chordpro/types";

export type RenderedSlide = { html: string; notesHtml: string };
export type RenderedDeck = {
  title: string;
  version: string;
  slides: RenderedSlide[];
};

const EMBED_SLIDE_CAP = 200;

// Load one embedded item's slides + updatedAt, owner-scoped. Returns null when
// the item is missing, trashed, or not the owner's.
async function loadEmbed(
  ownerId: string,
  id: string
): Promise<{ slides: DeckSlide[]; updatedAt: Date } | null> {
  let embed;
  try {
    embed = await getItem(ownerId, id);
  } catch (err) {
    if (err instanceof ItemError) return null;
    throw err;
  }
  if (embed.deletedAt) return null;

  const resolved = await resolveItemBodyTokens(ownerId, embed);
  if (isItemBody(resolved.body) && resolved.body.format === CHORDPRO_FORMAT) {
    const chart = parseChordPro(resolved.body.text);
    return { slides: chordProToSlides(chart).slice(0, EMBED_SLIDE_CAP), updatedAt: embed.updatedAt };
  }

  const embeddedDeck = buildDeck(bodyMarkdown(resolved.body), resolved.title);
  const slides =
    embeddedDeck.mode === "manuscript" ? embeddedDeck.slides.slice(1) : embeddedDeck.slides;
  return { slides: slides.slice(0, EMBED_SLIDE_CAP), updatedAt: embed.updatedAt };
}

export async function loadDeck(
  ownerId: string,
  itemId: string
): Promise<RenderedDeck | null> {
  let item;
  try {
    item = await getItem(ownerId, itemId);
  } catch (err) {
    if (err instanceof ItemError) return null;
    throw err;
  }
  if (item.deletedAt) return null;

  const resolved = await resolveItemBodyTokens(ownerId, item);
  const deck = buildDeck(bodyMarkdown(resolved.body), resolved.title);

  let latest = item.updatedAt;
  const slides: DeckSlide[] = [];
  for (const slide of deck.slides) {
    const embedId = soleMention(slide.md);
    const embed = embedId && embedId !== itemId ? await loadEmbed(ownerId, embedId) : null;
    if (!embed) {
      slides.push(slide);
      continue;
    }
    if (embed.updatedAt > latest) latest = embed.updatedAt;
    for (const es of embed.slides) {
      slides.push({ md: es.md, notes: [slide.notes, es.notes].filter(Boolean).join("\n\n") });
    }
  }

  return {
    title: resolved.title,
    // The player polls this to detect a change (step 2); an embedded song's
    // edit must trip it too, so it's the later of the item and its embeds.
    version: latest.toISOString(),
    slides: slides.map((s) => ({
      // Comments are notes-to-self already pulled out as `notes` by buildDeck;
      // never render them into the slide body itself.
      html: markdownToHtml(s.md, undefined, { comments: false }),
      notesHtml: markdownToHtml(s.notes, undefined, { comments: false }),
    })),
  };
}
