// Type-catalog tools (ADR-047, ADR-102): list_types is the read every model
// should call before create_item/list_items; create_type/update_type are the
// workspace-shaping writes, thin wrappers over the same parseTypeInput the
// Build REST routes use so the model literally can't persist an illegal type.
import { createType, listTypes, parseTypeInput, updateType } from "@/lib/types";
import { reqString } from "./args";
import { typeView } from "./serializers";
import type { McpTool } from "./wire";

export const typeTools: McpTool[] = [
  {
    name: "list_types",
    title: "List types",
    description:
      "List every item type in this Ledgr (the five system types — task, " +
      "event, note, link, person — plus any custom types) with each type's " +
      "custom properties (key, label, kind, select options, and a relation " +
      "field's target type + cardinality). Call this before create_item/" +
      "list_items when you need the exact type key or the property keys to set.",
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
];
