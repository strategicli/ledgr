// AI Memory tools (ADR-137): get_memory_stumps loads the compact stump index
// at session start; remember files one durable memory + links it to the
// items it's about. Gated by settings.aiMemoryEnabled — see MEMORY_TOOL_NAMES
// below and its use in index.ts's listToolDefs/callTool.
import { parseItemPayload } from "@/lib/api";
import { makeMarkdownBody } from "@/lib/body";
import { ItemError } from "@/lib/items";
import { createItem } from "@/lib/item-mutations";
import {
  MEMORY_HORIZONS,
  MEMORY_KINDS,
  MEMORY_TYPE,
  getMemoryStumps,
  renderStumpIndex,
} from "@/lib/memory";
import { assertOwnedItems, relateItems } from "@/lib/relations";
import { optBodyMarkdown, optEnum, optInt, optUuidArray, reqString } from "./args";
import { rowView } from "./serializers";
import type { McpTool } from "./wire";

// The AI Memory tools (ADR-137): present only when the owner has turned the
// subsystem on (settings.aiMemoryEnabled). Filtered out of tools/list and
// rejected by callTool when off, so a "vanilla" MCP client never sees the
// memory concept and its AI never gets confused by tools it can't use.
export const MEMORY_TOOL_NAMES = ["get_memory_stumps", "remember"] as const;

export const memoryTools: McpTool[] = [
  {
    name: "get_memory_stumps",
    title: "Get memory stumps",
    description:
      "Load the owner's always-on AI memory: the standing rules they need you to " +
      "have in front of you on every run. CALL THIS AT THE START OF A SESSION. " +
      "It returns the `pinned` memories only, one compact line each, with the date " +
      "and age of each. This is NOT the whole store: everything else is found on " +
      "demand with search_items(<name>, type: \"memory\") once a task names a " +
      "person, project, or system. Pass includeAll to browse the full store (audit " +
      "and cleanup work). A stump is only a pointer — get_item its id for the " +
      "detail and its links. Read the memory-protocol resource for how to recall " +
      "and when to remember.",
    inputSchema: {
      type: "object",
      properties: {
        includeAll: {
          type: "boolean",
          description:
            "Return every memory, not just the pinned always-on set. For audit and browse. Default false.",
        },
        limit: {
          type: "integer",
          description: "Max stumps (1–500, default 200).",
          minimum: 1,
          maximum: 500,
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const { stumps, total } = await getMemoryStumps(ownerId, {
        includeAll: args.includeAll === true,
        limit: optInt(args, "limit"),
      });
      return renderStumpIndex(stumps, total);
    },
  },
  {
    name: "remember",
    title: "Remember",
    description:
      "File one durable memory for future sessions, in a single call: creates a " +
      "memory item and links it to the people / projects / notes it's about (pass " +
      "their item ids in `about`). Use this whenever you learn something worth " +
      "keeping — a working preference, a fact about a person, a project decision. " +
      "Keep the title a short, self-contained \"stump\" (it's what a future agent " +
      "reads in a search result); put the detail, and a why / how-to-apply, in " +
      "bodyMarkdown. `horizon` and `pinned` are independent: horizon says how long " +
      "the claim stays TRUE, pinned says whether it must load every run. Pin only " +
      "the few standing rules that must always load. Prefer linking over " +
      "restating: a memory about Roger should link to " +
      "the Roger person (search_items for the id) rather than repeat what Ledgr " +
      "already holds.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "The stump: a short, self-contained reminder. This is what a future agent sees in a search result, so make it specific enough to judge relevance without opening the memory.",
        },
        bodyMarkdown: {
          type: "string",
          description:
            "The detail — the fact, plus a why / how-to-apply. Markdown. Also accepted as `body`.",
        },
        kind: {
          type: "string",
          enum: [...MEMORY_KINDS],
          description:
            "What this memory is about: user (who they are) | feedback (how to work with them) | project (ongoing work) | reference (a pointer/resource).",
        },
        horizon: {
          type: "string",
          enum: [...MEMORY_HORIZONS],
          description:
            "How long this stays TRUE, independent of how often it's needed. evergreen = a claim that stays true indefinitely (\"the owner has two kids\"). seasonal = true for a season and expected to stop being true (\"the church is searching for a campus pastor\"). episodic = true of a single moment. Never edit a seasonal memory to keep it accurate: file a new one when the situation changes, and the rendered dates will show which is current. This does NOT control whether the memory loads into context; that's `pinned`. Rule of thumb: kind=project is usually seasonal; kind=reference or user is usually evergreen.",
        },
        pinned: {
          type: "boolean",
          description:
            "Load this stump into every session's context. Independent of `horizon`: a fact can be permanently true and rarely needed (evergreen, unpinned), or temporary and needed constantly (seasonal, pinned). Pin ONLY standing behavioural rules that have no entity to search on, e.g. \"always hand the owner PowerShell, never bash\". A fact about a person, project, or system stays unpinned and is found via search_items(type: \"memory\"). Target: under 15 pinned memories total.",
        },
        about: {
          type: "array",
          items: { type: "string" },
          description:
            "Item ids this memory is about (people, projects, notes). Linked as confirmed relations — the recall graph.",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (ownerId, args) => {
      const title = reqString(args, "title");
      const kind = optEnum(args, "kind", MEMORY_KINDS);
      const horizon = optEnum(args, "horizon", MEMORY_HORIZONS);
      let pinned: boolean | undefined;
      if (args.pinned !== undefined && args.pinned !== null) {
        if (typeof args.pinned !== "boolean") {
          throw new ItemError("bad_request", "pinned must be a boolean");
        }
        pinned = args.pinned;
      }
      const properties: Record<string, unknown> = {};
      if (kind) properties.kind = kind;
      if (horizon) properties.horizon = horizon;
      if (pinned !== undefined) properties.pinned = pinned;
      const raw: Record<string, unknown> = { type: MEMORY_TYPE, title };
      const md = optBodyMarkdown(args);
      if (md !== undefined) raw.body = makeMarkdownBody(md);
      if (Object.keys(properties).length) raw.properties = properties;
      const input = parseItemPayload(raw, "create");
      const about = optUuidArray(args, "about");
      // Validate every `about` id up front, so a single bad/hallucinated id
      // fails the whole call rather than creating the memory and then leaving it
      // partially (or un-) linked when relateItems throws mid-loop.
      await assertOwnedItems(ownerId, about);
      const created = await createItem(ownerId, input);
      for (const targetId of about) {
        await relateItems(ownerId, created.id, targetId);
      }
      return {
        ...rowView(created),
        about,
        kind: kind ?? null,
        horizon: horizon ?? null,
        pinned: pinned ?? false,
      };
    },
  },
];
