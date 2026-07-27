// The "Note Editing Partner" prompt (ADR-162). The canonical, tuned text lives
// HERE in the repo so it stays in lockstep with how the live-context MCP tools
// actually behave (no drift). When the owner turns Live editing context on, we
// seed it as an editable `prompt` item (their muscle memory: "use my note-editing
// prompt" → search_items type=prompt → follow it as instructions). The item is
// theirs to edit; "Revert to default" re-writes its body from the constant below.
//
// This is the "somewhere in the middle" of Brandon's three options (2026-07-16):
// version-controlled default + user-editable copy + revert.
import { parseItemPayload } from "@/lib/api";
import { makeMarkdownBody } from "@/lib/body";
import { getItem } from "@/lib/items";
import { createItem, updateItem } from "@/lib/item-mutations";
import { getType } from "@/lib/types";
import { getSettings, updateSettings } from "@/lib/settings";

export const NOTE_EDITING_PROMPT_TITLE = "Note Editing Partner";

// Marker on the seeded item's properties, so it's recognizable as the system-
// seeded prompt independent of its title (which the owner may rename).
const PROMPT_MARKER = "note-editing-partner";

// The canonical prompt text. Tuned to the get_active_context / edit_item_body
// contract; keep it in sync when those tools change.
export const NOTE_EDITING_PROMPT_BODY = `A live, back-and-forth note-editing session, the way Notion's AI sidebar works: you always know the note I currently have open in Ledgr, and we sharpen it together while I also edit it directly with my own keyboard and mouse.

## Knowing what "this" means

- Call \`get_active_context\` at the start of the session, and AGAIN whenever I say "this note", "this page", "the draft", "this", "it", or ask what you think of it. It returns the open note's freshly-read body and anything I've highlighted.
- Never trust a version of the note you saw earlier. I edit by hand between your turns, so re-read every time before you comment or change anything. If \`contextAgeSeconds\` is large, I may have stepped away, so check in rather than assume.
- If nothing is open, \`get_active_context\` returns \`active:false\`. Ask me to open the note, or find it with \`search_items\`.

## A highlighted selection is the focus

- When \`get_active_context\` returns a \`selection\`, that's the specific text I mean ("rework this sentence", "tighten this"). Work on the selection, but read it in the context of the whole note.
- No selection means I'm talking about the whole note.

## Making changes

- Talk first. Make changes only when I say to go ahead, or when I clearly ask for the edit outright. Propose the change in the chat, then write it.
- Use \`edit_item_body\` for a targeted change, not \`update_item\`. It replaces one exact spot, so it won't clobber edits I've made elsewhere in the note. Make \`find\` unique by including enough surrounding text (the selection text is perfect for this). Use \`replace: ""\` to delete.
- Only use \`update_item\` when I ask for a full rewrite of the whole note.
- After you edit, tell me in one line what you changed. I'll tab back to Ledgr and it pulls your change in automatically.

## Voice

Match my writing style in anything you draft: warm, direct, concise, active voice, and no em dashes (use commas, colons, parentheticals, or a reworked sentence instead). Don't split a contrast into two choppy sentences.`;

// Resolve the type to seed under: `prompt` if that type exists in this instance
// (Brandon's convention), else fall back to `note` so the feature still works on
// a fresh/other instance that hasn't created a prompt type.
async function promptTypeKey(): Promise<string> {
  try {
    const t = await getType("prompt");
    return t.deletedAt ? "note" : "prompt";
  } catch {
    return "note";
  }
}

// The owner's seeded prompt item id if it still exists (and isn't trashed), else
// null. Checks the id remembered in settings.
async function existingPromptId(ownerId: string): Promise<string | null> {
  const { noteEditingPromptItemId } = await getSettings(ownerId);
  if (!noteEditingPromptItemId) return null;
  try {
    const item = await getItem(ownerId, noteEditingPromptItemId);
    return item.deletedAt ? null : item.id;
  } catch {
    return null;
  }
}

// Ensure the owner has the Note Editing Partner prompt item, creating it (and
// remembering its id in settings) if missing. Idempotent: called on every
// enable, but only creates once. Returns the item id.
export async function ensureNoteEditingPrompt(ownerId: string): Promise<string> {
  const existing = await existingPromptId(ownerId);
  if (existing) return existing;

  const input = parseItemPayload(
    {
      type: await promptTypeKey(),
      title: NOTE_EDITING_PROMPT_TITLE,
      body: makeMarkdownBody(NOTE_EDITING_PROMPT_BODY),
      properties: { system: PROMPT_MARKER },
    },
    "create"
  );
  const created = await createItem(ownerId, input);
  await updateSettings(ownerId, { noteEditingPromptItemId: created.id });
  return created.id;
}

// Reset the prompt item's body (and title) to the canonical default — the
// "Revert to default" action. Re-seeds first if the item is missing, so revert
// always yields a good prompt. Returns the item id.
export async function revertNoteEditingPrompt(ownerId: string): Promise<string> {
  const id = await ensureNoteEditingPrompt(ownerId);
  await updateItem(ownerId, id, {
    title: NOTE_EDITING_PROMPT_TITLE,
    body: makeMarkdownBody(NOTE_EDITING_PROMPT_BODY),
  });
  return id;
}
