// Hand-rolled MCP tool-argument parsing: every failure throws ItemError so
// callTool's catch turns it into a clean isError result instead of a thrown
// exception reaching the transport. Split out of the old monolithic tools.ts
// (ADR-047).
import { asUuid } from "@/lib/api";
import { makeMarkdownBody } from "@/lib/body";
import { ItemError } from "@/lib/items";

export function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ItemError("bad_request", `${key} must be a string`);
  const t = v.trim();
  return t === "" ? undefined : t;
}

export function reqString(args: Record<string, unknown>, key: string): string {
  const v = optString(args, key);
  if (v === undefined) throw new ItemError("bad_request", `${key} is required`);
  return v;
}

export function optInt(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new ItemError("bad_request", `${key} must be an integer`);
  return n;
}

export function optEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const v = optString(args, key);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new ItemError("bad_request", `${key} must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}

// An object of string→string (e.g. {{ask:Label}} answers); non-string values
// are dropped. Returns undefined for a missing/empty/non-object value.
export function optStringRecord(
  args: Record<string, unknown>,
  key: string
): Record<string, string> | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) {
    throw new ItemError("bad_request", `${key} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

export function optUuidArray(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ItemError("bad_request", `${key} must be an array of item ids`);
  return v.map((x) => asUuid(x, `${key} entry`));
}

// Property keys that map 1:1 onto the REST item fields (everything except the
// body, which MCP takes as a markdown string and turns into an ItemBody here).
const WRITE_FIELDS = [
  "title",
  "status",
  "urgency",
  "dueDate",
  "meetingAt",
  "url",
  "kind",
  "properties",
  "inbox",
] as const;

// Builds the ItemInput/ItemPatch raw object for parseItemPayload from MCP args.
// MCP takes the body as a markdown string (bodyMarkdown); everything else maps
// 1:1 onto the REST item fields, so parseItemPayload does the real validation.
export function buildWriteRaw(
  args: Record<string, unknown>,
  extra: string[]
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const k of [...WRITE_FIELDS, ...extra]) {
    if (k in args && args[k] !== undefined) raw[k] = args[k];
  }
  if (args.bodyMarkdown !== undefined && args.bodyMarkdown !== null) {
    if (typeof args.bodyMarkdown !== "string") {
      throw new ItemError("bad_request", "bodyMarkdown must be a string");
    }
    raw.body = makeMarkdownBody(args.bodyMarkdown);
  }
  return raw;
}
