import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { createBlogspotMcpServer } from "../../src/server.js";
import { BLOG_ID, FakeAdapter, matchingPost, VALID_PROJECTION } from "../helpers/fake-adapter.js";

type Connected = {
  client: Client;
  server: McpServer;
};

const connected: Connected[] = [];

async function connect(adapter = new FakeAdapter()): Promise<Connected> {
  const server = createBlogspotMcpServer({ blogId: BLOG_ID, adapter });
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const pair = { client, server };
  connected.push(pair);
  return pair;
}

function structured(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  const text = result.content.find(item => item.type === "text");
  expect(text?.type).toBe("text");
  if (text?.type === "text") expect(JSON.parse(text.text)).toEqual(result.structuredContent);
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

afterEach(async () => {
  while (connected.length > 0) {
    const pair = connected.pop();
    if (pair !== undefined) {
      await pair.client.close();
      await pair.server.close();
    }
  }
});

describe("MCP surface", () => {
  it("advertises exactly the two approved tools and no publish capability", async () => {
    const { client } = await connect();
    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name)).toEqual(["create_draft", "inspect_draft"]);
    expect(result.tools.every(tool => tool.inputSchema !== undefined && tool.outputSchema !== undefined)).toBe(true);
    expect(JSON.stringify(result.tools)).not.toMatch(/publish|delete|update|schedule/i);
  });

  it("returns schema-valid structured and equivalent text results", async () => {
    const { client } = await connect();
    const created = structured(await client.callTool({ name: "create_draft", arguments: VALID_PROJECTION }));
    expect(created.outcome).toBe("VERIFIED");

    const inspected = structured(await client.callTool({
      name: "inspect_draft",
      arguments: { post_id: "9876543210", expected: VALID_PROJECTION }
    }));
    expect(inspected.outcome).toBe("VERIFIED");
  });

  it("routes wrongly typed product fields to structured VALIDATION_FAILED", async () => {
    const adapter = new FakeAdapter();
    const { client } = await connect(adapter);
    const result = structured(await client.callTool({
      name: "create_draft",
      arguments: { title: 42, body: null, source: "wrong", publish: true }
    }));
    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(adapter.inserts).toHaveLength(0);
  });

  it("cannot report VERIFIED for a remote mismatch", async () => {
    const adapter = new FakeAdapter(
      { ok: true, postId: "9876543210" },
      { ok: true, post: matchingPost({ title: "tampered" }) }
    );
    const { client } = await connect(adapter);
    const result = structured(await client.callTool({ name: "create_draft", arguments: VALID_PROJECTION }));
    expect(result.outcome).toBe("MISMATCH");
  });
});
