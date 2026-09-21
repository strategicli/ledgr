// Export tool (2026-09-21, ADR-183 carve-out): render an item through one of its
// deterministic exporters, over MCP.
//
// The exporters have existed since the module boundary (ADR-043): a song
// renders to Planning Center's ChordPro dialect, a paper to an MSM-compliant
// .docx. Both were reachable only from a button on the canvas or the
// render-docx route, which needs a browser session — so an assistant asked to
// "send me the chart for Planning Center" or "give me the Word file" had to
// answer "open it and click". This is a thin wrapper over the same renderers,
// so the output here is byte-for-byte what the app produces: a disposable
// render of the markdown source, never stored (Principle 1, "rendered from,
// never a second source").
//
// Text exporters come from `exportersForType` (the module registry, so a type
// borrowing the chord-chart tool exports too). The paper .docx is binary, which
// is exactly why it is a dedicated route rather than a module ExporterDef
// (whose render returns a string); rather than widen that core contract, this
// tool offers it under the id `docx` for paper-shaped types and returns the
// bytes base64-encoded.
import { asUuid } from "@/lib/api";
import { bodyMarkdown, isItemBody, makeMarkdownBody } from "@/lib/body";
import { getItem, ItemError } from "@/lib/items";
import { resolveItemBodyTokens } from "@/lib/item-tokens-service";
import { exportersForType } from "@/lib/modules";
import { renderMsmDocx } from "@/lib/papers/msm-docx";
import type { PaperMeta } from "@/lib/papers/types";
import { listTypes } from "@/lib/types";
import { optString } from "./args";
import type { McpTool } from "./wire";

const DOCX_ID = "docx";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PAPER_CAPABILITY = "paper-workspace";

export type ExportOption = { id: string; label: string; fileExtension: string };

// Whether this type renders the paper .docx: the `paper` type itself, or a
// user-named type that borrowed the paper workspace (same PaperMeta shape).
function hasDocx(type: string, capability: string | null | undefined): boolean {
  return type === "paper" || capability === PAPER_CAPABILITY;
}

// Every export a type offers, text exporters first, the .docx last. Pure, so
// list_types can advertise it without a query.
export function exportsForTypeView(
  type: string,
  capability: string | null | undefined
): ExportOption[] {
  const out: ExportOption[] = exportersForType(type, undefined, capability).map((e) => ({
    id: e.id,
    label: e.label,
    fileExtension: e.fileExtension,
  }));
  if (hasDocx(type, capability)) {
    out.push({ id: DOCX_ID, label: "Word (.docx)", fileExtension: "docx" });
  }
  return out;
}

// "A Teaching Overview of First Peter" -> "a-teaching-overview-of-first-peter"
// (mirrors the render-docx route so the filename matches a browser download).
function slugify(title: string, fallback: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback
  );
}

export const exportTools: McpTool[] = [
  {
    name: "export_item",
    title: "Export item",
    description:
      "Render an item through one of its exporters and return the result: a " +
      "song's chart as Planning Center ChordPro (`song-chordpro-pco`), a paper " +
      "as a Word document (`docx`, returned base64-encoded with its filename). " +
      "Which exports a type offers is listed under `exports` on list_types. " +
      "Pass `format` to pick one; when the type offers exactly one it may be " +
      "omitted. The output is rendered fresh from the item's markdown every " +
      "time and is never stored, so it is always current.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The item id (UUID)." },
        format: {
          type: "string",
          description:
            "Export id from the type's `exports` (list_types), e.g. \"song-chordpro-pco\" or \"docx\". " +
            "Optional when the type offers exactly one.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ownerId, args) => {
      const id = asUuid(args.id, "id");
      const item = await getItem(ownerId, id);
      const defs = await listTypes({ includeHidden: true });
      const capability = defs.find((t) => t.key === item.type)?.capability ?? null;
      const available = exportsForTypeView(item.type, capability);
      if (available.length === 0) {
        throw new ItemError("bad_request", `type '${item.type}' has no exporters`);
      }
      const requested = optString(args, "format");
      const names = available.map((e) => e.id).join(", ");
      if (requested === undefined && available.length > 1) {
        throw new ItemError("bad_request", `type '${item.type}' offers several exports — pass format, one of: ${names}`);
      }
      const formatId = requested ?? available[0].id;
      const chosen = available.find((e) => e.id === formatId);
      if (!chosen) {
        throw new ItemError("bad_request", `unknown export '${formatId}' for type '${item.type}'; it has: ${names}`);
      }
      const base = { id: item.id, title: item.title, type: item.type, format: chosen.id, label: chosen.label, fileExtension: chosen.fileExtension };

      if (chosen.id === DOCX_ID) {
        // Same steps as GET /api/items/[id]/render-docx: resolve live
        // {{item.*}} tokens so the document carries real values, then render.
        const resolved = await resolveItemBodyTokens(ownerId, {
          id: item.id,
          title: item.title,
          body: item.body,
        });
        const props = (item.properties as PaperMeta | null) ?? {};
        const meta: PaperMeta & { title?: string } = {
          title: resolved.title,
          school: props.school,
          paper_type: props.paper_type,
          course: props.course,
          author: props.author,
          location: props.location,
          paper_date: props.paper_date,
        };
        const { buffer, footnoteCount } = await renderMsmDocx(bodyMarkdown(resolved.body), meta);
        return {
          ...base,
          filename: `${slugify(resolved.title || "paper", "paper")}.docx`,
          mimeType: DOCX_MIME,
          encoding: "base64",
          bytes: buffer.byteLength,
          footnoteCount,
          data: buffer.toString("base64"),
        };
      }

      const exporter = exportersForType(item.type, ownerId, capability).find((e) => e.id === chosen.id);
      if (!exporter) {
        throw new ItemError("bad_request", `export '${chosen.id}' is not enabled for this owner`);
      }
      // The stored body is untyped jsonb; the tolerant reader gives the renderer
      // the {format, text} wrapper it expects whatever shape the row carries.
      const body = isItemBody(item.body) ? item.body : makeMarkdownBody(bodyMarkdown(item.body));
      const text = await exporter.render(body, item);
      return {
        ...base,
        filename: `${slugify(item.title || item.type, item.type)}.${chosen.fileExtension}`,
        text,
      };
    },
  },
];
