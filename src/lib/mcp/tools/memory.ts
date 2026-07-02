// AI Memory tools (ADR-137): get_memory_stumps loads the compact stump index
// at session start; remember files one durable memory + links it to the
// items it's about. Gated by settings.aiMemoryEnabled — see MEMORY_TOOL_NAMES
// below and its use in index.ts's listToolDefs/callTool.
import { parseItemPayload } from "@/lib/api";
import { makeMarkdownBody } from "@/lib/body";
import { ItemError, createItem } from "@/lib/items";
import {
  MEMORY_HORIZONS,
  MEMORY_KINDS,
  MEMORY_TYPE,
  getMemoryStumps,
} from "@/lib/memory";
import { relateItems } from "@/lib/relations";
import { optEnum, optInt, optUuidArray, reqString } from "./args";
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
      "Load the owner's AI-memory \"stumps\": a compact, body-free index of the " +
      "durable facts they've chosen to remember, each with the people / projects / " +
      "notes it's linked to. CALL THIS AT THE START OF A SESSION so you know what " +
      "exists. A stump is only a pointer — when one is relevant to the current " +
      "conversation, get_item it (and follow the promising `linked` items) to pull " +
      "the detail. By default returns the always-on set (evergreen + pinned + " +
      "recently-touched); pass includeAll to browse the whole store. Read the " +
      "memory-protocol resource for how to recall and when to remember.",
    inputSchema: {
      type: "object",
      properties: {
        includeAll: {
          type: "boolean",
          description:
            "Return every memory, not just the always-on set (evergreen/pinned/recent). Default false.",
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
      const includeAll = args.includeAll === true;
      const stumps = await getMemoryStumps(ownerId, {
        includeAll,
        limit: optInt(args, "limit"),
      });
      return { count: stumps.length, includeAll, stumps };
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
      "Keep the title a short, self-contained \"stump\" (it's what loads always-on); " +
      "put the detail, and a why / how-to-apply, in bodyMarkdown. Set kind + " +
      "horizon so the stump ages correctly; pin only the few that must always " +
      "load. Prefer linking over restating: a memory about Roger should link to " +
      "the Roger person (search_items for the id) rather than repeat what Ledgr " +
      "already holds.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "The stump: a short, self-contained reminder (this is what loads always-on).",
        },
        bodyMarkdown: {
          type: "string",
          description: "The detail — the fact, plus a why / how-to-apply. Markdown.",
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
            "How long it stays true: evergreen (always) | seasonal (a while) | episodic (a moment). Seasonal/episodic age out of the always-on set.",
        },
        pinned: {
          type: "boolean",
          description:
            "Force this stump always-on regardless of horizon/age. Use sparingly.",
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
      if (args.bodyMarkdown !== undefined && args.bodyMarkdown !== null) {
        if (typeof args.bodyMarkdown !== "string") {
          throw new ItemError("bad_request", "bodyMarkdown must be a string");
        }
        raw.body = makeMarkdownBody(args.bodyMarkdown);
      }
      if (Object.keys(properties).length) raw.properties = properties;
      const input = parseItemPayload(raw, "create");
      const created = await createItem(ownerId, input);
      const about = optUuidArray(args, "about");
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
