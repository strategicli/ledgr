// Wire-level types shared by every MCP tool family file + the registry
// (index.ts). Split out of the old monolithic tools.ts (ADR-047).

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

// Hints (MCP toolAnnotations) so a client can label/treat tools sensibly.
// openWorldHint is false everywhere: every tool reads or writes only the
// owner's own Ledgr data, never an open external system.
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
};

export type McpTool = McpToolDef & {
  handler: (ownerId: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type ToolCallResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};
