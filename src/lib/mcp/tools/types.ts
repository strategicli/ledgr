// Type-catalog tools (ADR-047, ADR-102): list_types is the read every model
// should call before create_item/list_items; create_type/update_type are the
// workspace-shaping writes, thin wrappers over the same parseTypeInput the
// Build REST routes use so the model literally can't persist an illegal type.
import { ItemError } from "@/lib/items";
import {
  CATEGORY_DEFAULT_COLOR,
  CATEGORY_META,
  STATUS_CATEGORIES,
  STATUS_MODES,
  resolveStatusSchema,
  type StatusCategory,
  type StatusDef,
} from "@/lib/status";
import {
  createType,
  getType,
  listTypes,
  parseTypeInput,
  setTypeStatusConfig,
  updateType,
} from "@/lib/types";
import { optEnum, reqString } from "./args";
import { typeView } from "./serializers";
import type { McpTool } from "./wire";

// A status key from a label: "Waiting for Others" → "waiting_for_others". Keys
// are opaque (the label is what shows), so the model never has to invent one —
// but a caller may pass an explicit key to RENAME a label while keeping the key,
// which matters because items store the key.
function keyFromLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return /^[a-z]/.test(slug) ? slug : `status_${slug || "1"}`;
}

export const typeTools: McpTool[] = [
  {
    name: "list_types",
    title: "List types",
    description:
      "List every item type in this Ledgr (the five system types — task, " +
      "event, note, link, person — plus any custom types) with each type's " +
      "custom properties (key, label, kind, select options, and a relation " +
      "field's target type + cardinality). Call this before create_item/" +
      "list_items when you need the exact type key or the property keys to set. " +
      "Each type also reports how it tracks completion — statusMode (none | " +
      "checkbox | select) and, for select, its STATUS TERMS in order with each " +
      "one's category and which is the default. Those are the exact status keys " +
      "create_item/update_item accept; change them with set_type_statuses.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: async () => {
      const defs = await listTypes();
      return {
        types: defs.map((t) => ({
          key: t.key,
          label: t.label,
          isSystem: t.isSystem,
          showInQuickCapture: t.showInQuickCapture,
          statusMode: t.statusMode,
          // The effective terms, not the raw column: a type storing null
          // inherits the system default, and that's what its items actually use.
          ...(t.statusMode === "select"
            ? {
                statuses: resolveStatusSchema(t.statusSchema).map((s) => ({
                  key: s.key,
                  label: s.label,
                  category: s.category,
                  ...(s.isDefault ? { isDefault: true } : {}),
                })),
                statusesAreCustom: t.statusSchema != null,
              }
            : {}),
          properties: t.propertySchema.map((p) => ({
            key: p.key,
            label: p.label,
            kind: p.kind,
            ...(p.options ? { options: p.options } : {}),
            // Relation fields (kind "relation") carry their target type + how
            // many they accept, so the model knows what create_item /
            // relate_items should link (ADR-067).
            ...(p.targetType != null ? { targetType: p.targetType } : {}),
            ...(p.cardinality ? { cardinality: p.cardinality } : {}),
          })),
        })),
      };
    },
  },
  {
    name: "create_type",
    title: "Create type",
    description:
      "Create a new item type (a kind of item with its own custom properties) — " +
      "the 'make me a place to track X' move. `key` is a lowercase slug, " +
      "immutable once created; `label` is the display name. `propertySchema` is " +
      "the type's fields: each { key, label, kind } where kind is text | number | " +
      "date | checkbox | url | select | multi_select (these need an `options` " +
      "string array) | relation (a typed link — set `targetType` to the type key " +
      "it links to, or omit for any, plus `cardinality` single|many). Example: a " +
      "'sermon' type with a `series` select, a `date`, and a `passage` relation. " +
      "Call describe_workspace/list_types first to avoid duplicating an existing " +
      "type, and confirm the shape with the owner before creating.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Lowercase slug, immutable (letters, digits, _; starts with a letter). E.g. 'sermon'." },
        label: { type: "string", description: "Display name. E.g. 'Sermon'." },
        icon: { type: "string", description: "Optional icon key." },
        propertySchema: {
          type: "array",
          description: "The type's custom fields (see the description for the per-field shape). Omit for none.",
          items: { type: "object" },
        },
        showInQuickCapture: { type: "boolean", description: "Show this type in the quick-capture picker (default true)." },
        capability: { type: "string", description: "Optional bespoke-tool capability id (advanced; omit for the default markdown canvas)." },
      },
      required: ["key", "label"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: async (_ownerId, args) => {
      const created = await createType(parseTypeInput(args, "create"));
      return typeView(created);
    },
  },
  {
    name: "update_type",
    title: "Update type",
    description:
      "Edit an existing type by key. This REPLACES the type's editable fields " +
      "(label, icon, propertySchema, showInQuickCapture, capability) wholesale, " +
      "so to add one property you must resend the FULL propertySchema — read the " +
      "current one (list_types/describe_workspace) and append your addition, or " +
      "you'll drop the rest. The key is immutable and can't change here. System " +
      "types (task, event, note, link, person) can be edited but not deleted. " +
      "Confirm with the owner before changing a type that's in use.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The type's key (slug) to edit." },
        label: { type: "string", description: "Display name (required — resend the current one if unchanged)." },
        icon: { type: "string", description: "Optional icon key." },
        propertySchema: {
          type: "array",
          description: "The FULL property list to store (replaces the existing one). See create_type for the per-field shape.",
          items: { type: "object" },
        },
        showInQuickCapture: { type: "boolean", description: "Show in the quick-capture picker." },
        capability: { type: "string", description: "Bespoke-tool capability id, or omit/empty for the default canvas." },
      },
      required: ["key", "label"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (_ownerId, args) => {
      const key = reqString(args, "key").toLowerCase();
      const updated = await updateType(key, parseTypeInput(args, "patch"));
      return typeView(updated);
    },
  },
  {
    name: "set_type_statuses",
    title: "Set a type's status terms",
    description:
      "Define the STATUS TERMS for a type — what the stages are called and what " +
      "they mean (\"projects should be Ongoing, Waiting for Others, Paused, " +
      "Future, Done\"). Pass statuses as a list, in the order you want them, " +
      "each with a label and a category. Category is the part that carries " +
      "meaning, and there are exactly four: not_started, in_progress, done, " +
      "archived. The label is yours to name; the category is how the rest of " +
      "Ledgr reasons about it (what counts as finished for progress bars and " +
      "roll-ups, what the done checkbox completes to, what a recurring task " +
      "advances on). You need at least one done and one active " +
      "(not_started/in_progress) term.\n\n" +
      "Keys are derived from labels automatically, so you can just send labels. " +
      "RENAMING: items store the key, so to rename a term without re-bucketing " +
      "its items, resend it with its existing key (from list_types) and the new " +
      "label. Dropping a term leaves any item still on it in its category's " +
      "default. Set mode instead of statuses to change HOW completion shows: " +
      "'checkbox' (a plain done box), 'none' (no status at all), or 'select' " +
      "(these named stages, shown as a dropdown and kanban columns). Switching " +
      "away from select KEEPS your terms, so switching back restores them.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "The type's key, e.g. 'project' (see list_types)." },
        mode: {
          type: "string",
          enum: [...STATUS_MODES],
          description:
            "How this type shows completion: select (named stages) | checkbox " +
            "(done / not done) | none. Defaults to select when you pass statuses.",
        },
        statuses: {
          type: "array",
          description:
            "The full ordered list of terms (replaces the existing set). Each: " +
            "{ label, category, key?, color?, isDefault? }. category is one of " +
            "not_started | in_progress | done | archived.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "What it's called, e.g. 'Waiting for Others'." },
              category: { type: "string", enum: [...STATUS_CATEGORIES], description: "not_started | in_progress | done | archived." },
              key: { type: "string", description: "Optional existing key — pass it to RENAME a term without moving its items." },
              color: { type: "string", description: "Optional hex color, e.g. '#f59e0b'. Defaults to the category's color." },
              isDefault: { type: "boolean", description: "The default term within its category (one per category)." },
            },
            required: ["label", "category"],
            additionalProperties: false,
          },
        },
        inherit: { type: "boolean", description: "true = drop custom terms and inherit the system default (To Do / Done / Archived)." },
      },
      required: ["key"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (_ownerId, args) => {
      const key = reqString(args, "key").toLowerCase();
      const mode = optEnum(args, "mode", STATUS_MODES);

      // inherit: back to the system default, staying in select mode.
      if (args.inherit === true) {
        const updated = await setTypeStatusConfig(key, mode ?? "select", null);
        return {
          ...typeView(updated),
          statusMode: updated.statusMode,
          statuses: resolveStatusSchema(updated.statusSchema).map((s) => ({
            key: s.key,
            label: s.label,
            category: s.category,
          })),
          inherited: true,
        };
      }

      const raw = args.statuses;
      if (raw === undefined || raw === null) {
        // Mode-only change (e.g. "make projects a simple checkbox"). Passing no
        // schema preserves the stored terms — the defer-by-hiding rule.
        if (!mode) {
          throw new ItemError(
            "bad_request",
            "pass statuses (the terms), mode (how completion shows), or inherit:true"
          );
        }
        // A mode-only change must not disturb the stored terms. That takes care:
        // setTypeStatusConfig treats a null schema in SELECT mode as the explicit
        // "inherit the default" choice (it's what the Build panel's "Inherit
        // default" radio sends), so passing null here would silently wipe the
        // owner's terms on the way back from checkbox. Resend what's stored;
        // `inherit: true` is the deliberate way to clear.
        const current = await getType(key);
        const updated = await setTypeStatusConfig(key, mode, current.statusSchema);
        return {
          ...typeView(updated),
          statusMode: updated.statusMode,
          ...(updated.statusMode === "select"
            ? {
                statuses: resolveStatusSchema(updated.statusSchema).map((s) => ({
                  key: s.key,
                  label: s.label,
                  category: s.category,
                })),
              }
            : {}),
          note:
            mode === "select"
              ? "back to named stages, with your stored terms intact"
              : "your custom terms are kept, so switching back to select restores them",
        };
      }

      if (!Array.isArray(raw)) throw new ItemError("bad_request", "statuses must be an array");
      const seen = new Set<string>();
      const statuses: StatusDef[] = raw.map((entry, i) => {
        const at = `statuses[${i}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          throw new ItemError("bad_request", `${at} must be an object`);
        }
        const e = entry as Record<string, unknown>;
        const label = typeof e.label === "string" ? e.label.trim() : "";
        if (!label) throw new ItemError("bad_request", `${at}.label is required`);
        const category = typeof e.category === "string" ? e.category.trim().toLowerCase() : "";
        if (!(STATUS_CATEGORIES as readonly string[]).includes(category)) {
          throw new ItemError(
            "bad_request",
            `${at}.category must be one of: ${STATUS_CATEGORIES.join(", ")} ` +
              `(${STATUS_CATEGORIES.map((c) => `${c} = ${CATEGORY_META[c].label}`).join("; ")})`
          );
        }
        const cat = category as StatusCategory;
        let k = typeof e.key === "string" && e.key.trim() ? e.key.trim().toLowerCase() : keyFromLabel(label);
        // Two labels sluggifying the same way would collide; disambiguate rather
        // than fail, since the key is opaque and the label is what shows.
        if (seen.has(k)) {
          let n = 2;
          while (seen.has(`${k}_${n}`)) n += 1;
          k = `${k}_${n}`;
        }
        seen.add(k);
        const color =
          typeof e.color === "string" && /^#[0-9a-fA-F]{6}$/.test(e.color.trim())
            ? e.color.trim()
            : CATEGORY_DEFAULT_COLOR[cat];
        return {
          key: k,
          label,
          category: cat,
          color,
          ...(e.isDefault === true ? { isDefault: true as const } : {}),
        };
      });

      // Statuses only mean anything in select mode, so passing terms implies it.
      const updated = await setTypeStatusConfig(key, mode ?? "select", statuses);
      return {
        ...typeView(updated),
        statusMode: updated.statusMode,
        statuses: (updated.statusSchema ?? statuses).map((s) => ({
          key: s.key,
          label: s.label,
          category: s.category,
          ...(s.isDefault ? { isDefault: true } : {}),
        })),
      };
    },
  },
];
