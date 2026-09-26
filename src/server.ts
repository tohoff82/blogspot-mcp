import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  createDraftIngressSchema,
  createDraftResultSchema,
  inspectDraftIngressSchema,
  inspectDraftResultSchema,
  type BloggerAdapter
} from "./domain/contracts.js";
import { createDraft } from "./tools/create-draft.js";
import { inspectDraft } from "./tools/inspect-draft.js";

export type BlogspotMcpDependencies = {
  blogId: string;
  adapter: BloggerAdapter;
};

function toolResult(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

export function createBlogspotMcpServer(dependencies: BlogspotMcpDependencies): McpServer {
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
    async ingress => toolResult(await createDraft(ingress, dependencies))
  );

  server.registerTool(
    "inspect_draft",
    {
      title: "Inspect Blogger draft",
      description: "Read one post from the configured Blogger blog and compare it with an expected projection.",
      inputSchema: inspectDraftIngressSchema,
      outputSchema: inspectDraftResultSchema
    },
    async ingress => toolResult(await inspectDraft(ingress, dependencies))
  );

  return server;
}
