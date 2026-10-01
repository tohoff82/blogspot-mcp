import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  createDraftIngressSchema,
  createDraftResultSchema,
  inspectDraftIngressSchema,
  inspectDraftResultSchema,
  type BloggerAdapter,
  type ProvenanceStore
} from "./domain/contracts.js";
import { createDraft } from "./tools/create-draft.js";
import { inspectDraft } from "./tools/inspect-draft.js";

export type BlogspotMcpDependencies = {
  blogId: string;
  adapter: BloggerAdapter;
  provenanceStore: ProvenanceStore;
  reportInternalError?: () => void;
};

const INTERNAL_TOOL_ERROR = "Unexpected internal tool failure.";

function toolResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

async function guardedToolResult(
  operation: () => Promise<Record<string, unknown>>,
  reportInternalError: () => void
): Promise<CallToolResult> {
  try {
    return toolResult(await operation());
  } catch {
    try {
      reportInternalError();
    } catch {
      // Diagnostic failure must not expose or replace the sanitized tool response.
    }
    return {
      isError: true,
      content: [{ type: "text", text: INTERNAL_TOOL_ERROR }]
    };
  }
}

export function createBlogspotMcpServer(dependencies: BlogspotMcpDependencies): McpServer {
  const reportInternalError = dependencies.reportInternalError ?? (() => {
    process.stderr.write("blogspot-mcp tool failed: unexpected internal defect.\n");
  });
  const server = new McpServer(
    { name: "blogspot-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "create_draft",
    {
      title: "Create Blogger draft",
      description: "Create one private draft in the configured Blogger blog, read it back, and verify it.",
      inputSchema: createDraftIngressSchema,
      outputSchema: createDraftResultSchema
    },
    async ingress => guardedToolResult(
      async () => createDraftResultSchema.parse(await createDraft(ingress, dependencies)),
      reportInternalError
    )
  );

  server.registerTool(
    "inspect_draft",
    {
      title: "Inspect Blogger draft",
      description: "Read one post from the configured Blogger blog and compare it with an expected projection.",
      inputSchema: inspectDraftIngressSchema,
      outputSchema: inspectDraftResultSchema
    },
    async ingress => guardedToolResult(
      async () => inspectDraftResultSchema.parse(await inspectDraft(ingress, dependencies)),
      reportInternalError
    )
  );

  return server;
}
