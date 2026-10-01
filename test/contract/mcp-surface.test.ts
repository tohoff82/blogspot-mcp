import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { createBlogspotMcpServer } from "../../src/server.js";
import {
  createDraftResultSchema,
  inspectDraftResultSchema,
  type BloggerAdapter,
  type ProvenanceStore
} from "../../src/domain/contracts.js";
import { BLOG_ID, FakeAdapter, FakeProvenanceStore, matchingPost, VALID_PROJECTION } from "../helpers/fake-adapter.js";

type Connected = {
  client: Client;
  server: McpServer;
};

const connected: Connected[] = [];

async function connect(options: {
  adapter?: BloggerAdapter;
  provenanceStore?: ProvenanceStore;
  reportInternalError?: () => void;
} = {}): Promise<Connected> {
  const server = createBlogspotMcpServer({
    blogId: BLOG_ID,
    adapter: options.adapter ?? new FakeAdapter(),
    provenanceStore: options.provenanceStore ?? new FakeProvenanceStore(),
    ...(options.reportInternalError === undefined ? {} : { reportInternalError: options.reportInternalError })
  });
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
    const { client } = await connect({ adapter });
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
    const { client } = await connect({ adapter });
    const result = structured(await client.callTool({ name: "create_draft", arguments: VALID_PROJECTION }));
    expect(result.outcome).toBe("MISMATCH");
  });

  it("returns every declared create outcome as a schema-valid normal MCP result", async () => {
    const cases = [
      {
        outcome: "VALIDATION_FAILED",
        arguments: { title: 42 },
        adapter: new FakeAdapter()
      },
      { outcome: "VERIFIED", arguments: VALID_PROJECTION, adapter: new FakeAdapter() },
      {
        outcome: "CREATE_FAILED",
        arguments: VALID_PROJECTION,
        adapter: new FakeAdapter({ ok: false, kind: "definitive", code: "BLOGGER_HTTP_403", detail: "bounded" })
      },
      {
        outcome: "CREATED_UNVERIFIED",
        arguments: VALID_PROJECTION,
        adapter: new FakeAdapter({ ok: true })
      },
      {
        outcome: "MISMATCH",
        arguments: VALID_PROJECTION,
        adapter: new FakeAdapter(
          { ok: true, postId: "9876543210" },
          { ok: true, post: matchingPost({ status: "LIVE" }) }
        )
      },
      {
        outcome: "REMOTE_EFFECT_UNKNOWN",
        arguments: VALID_PROJECTION,
        adapter: new FakeAdapter({ ok: false, kind: "unknown", code: "POST_TIMEOUT", detail: "bounded" })
      }
    ] as const;

    for (const candidate of cases) {
      const { client } = await connect({ adapter: candidate.adapter });
      const result = structured(await client.callTool({ name: "create_draft", arguments: candidate.arguments }));
      expect(result.outcome).toBe(candidate.outcome);
      expect(createDraftResultSchema.safeParse(result).success).toBe(true);
      expect(result).toMatchObject({ action: "create_draft", target: { blog_id: BLOG_ID } });
      if (candidate.outcome === "VALIDATION_FAILED" || candidate.outcome === "CREATE_FAILED") {
        expect(result).toMatchObject({ remote_effect: "none", retry_safe: true });
      } else if (candidate.outcome === "REMOTE_EFFECT_UNKNOWN") {
        expect(result).toMatchObject({ remote_effect: "unknown", retry_safe: false });
      } else {
        expect(result).toMatchObject({ remote_effect: "created", retry_safe: false });
      }
      if (candidate.outcome === "VALIDATION_FAILED") {
        expect(result).toMatchObject({ error: { code: "INPUT_VALIDATION_FAILED", phase: "validation" } });
        expect(result.issues).toBeInstanceOf(Array);
      } else {
        expect(result.requested).toEqual(VALID_PROJECTION);
      }
      if (candidate.outcome === "VERIFIED") {
        expect(result.error).toBeUndefined();
        expect(result.checks).toHaveLength(6);
        expect((result.checks as Array<{ result: string }>).every(check => check.result === "MATCH")).toBe(true);
      } else if (candidate.outcome === "MISMATCH") {
        expect((result.checks as Array<{ result: string }>).some(check => check.result === "MISMATCH")).toBe(true);
        expect(result.error).toBeDefined();
      } else if (candidate.outcome === "CREATED_UNVERIFIED") {
        expect(result).toMatchObject({ error: { code: "POST_ID_MISSING", phase: "read_back" } });
      } else if (candidate.outcome === "CREATE_FAILED" || candidate.outcome === "REMOTE_EFFECT_UNKNOWN") {
        expect(result).toMatchObject({ error: { phase: "create" } });
      }
    }
  });

  it("returns every declared inspect outcome as a schema-valid normal MCP result", async () => {
    const cases = [
      { outcome: "VALIDATION_FAILED", arguments: { post_id: "bad", expected: {} }, adapter: new FakeAdapter() },
      { outcome: "VERIFIED", arguments: { post_id: "9876543210", expected: VALID_PROJECTION }, adapter: new FakeAdapter() },
      {
        outcome: "MISMATCH",
        arguments: { post_id: "9876543210", expected: VALID_PROJECTION },
        adapter: new FakeAdapter(
          { ok: true, postId: "unused" },
          { ok: true, post: matchingPost({ title: "changed" }) }
        )
      },
      {
        outcome: "ABSENT",
        arguments: { post_id: "9876543210", expected: VALID_PROJECTION },
        adapter: new FakeAdapter(
          { ok: true, postId: "unused" },
          { ok: false, kind: "absent", code: "BLOGGER_HTTP_404", detail: "bounded" }
        )
      },
      {
        outcome: "ACCESS_DENIED",
        arguments: { post_id: "9876543210", expected: VALID_PROJECTION },
        adapter: new FakeAdapter(
          { ok: true, postId: "unused" },
          { ok: false, kind: "access_denied", code: "BLOGGER_HTTP_403", detail: "bounded" }
        )
      },
      {
        outcome: "REMOTE_UNKNOWN",
        arguments: { post_id: "9876543210", expected: VALID_PROJECTION },
        adapter: new FakeAdapter(
          { ok: true, postId: "unused" },
          { ok: false, kind: "unknown", code: "BLOGGER_HTTP_503", detail: "bounded" }
        )
      }
    ] as const;

    for (const candidate of cases) {
      const { client } = await connect({ adapter: candidate.adapter });
      const result = structured(await client.callTool({ name: "inspect_draft", arguments: candidate.arguments }));
      expect(result.outcome).toBe(candidate.outcome);
      expect(inspectDraftResultSchema.safeParse(result).success).toBe(true);
      expect(result).toMatchObject({ action: "inspect_draft", target: { blog_id: BLOG_ID } });
      if (candidate.outcome === "VALIDATION_FAILED") {
        expect(result).toMatchObject({ error: { code: "INPUT_VALIDATION_FAILED", phase: "validation" } });
        expect(result.issues).toBeInstanceOf(Array);
      } else {
        expect(result.expected).toEqual(VALID_PROJECTION);
      }
      if (candidate.outcome === "VERIFIED") {
        expect(result.error).toBeUndefined();
        expect(result.checks).toHaveLength(6);
        expect((result.checks as Array<{ result: string }>).every(check => check.result === "MATCH")).toBe(true);
      } else if (candidate.outcome === "MISMATCH") {
        expect((result.checks as Array<{ result: string }>).some(check => check.result === "MISMATCH")).toBe(true);
        expect(result.error).toBeDefined();
      } else if (["ABSENT", "ACCESS_DENIED", "REMOTE_UNKNOWN"].includes(candidate.outcome)) {
        expect(result).toMatchObject({ error: { phase: "read" } });
        expect(result.checks).toBeUndefined();
      }
    }
  });

  it("sanitizes unexpected internal defects and reserves isError for that path", async () => {
    const secretMarker = "Bearer credential-shaped-secret-fixture";
    const diagnostics: string[] = [];
    const adapter: BloggerAdapter = {
      async insertDraft() {
        throw new Error(secretMarker);
      },
      async getPostAdmin() {
        throw new Error(secretMarker);
      }
    };
    const { client } = await connect({
      adapter,
      reportInternalError: () => diagnostics.push("unexpected internal defect")
    });

    for (const request of [
      { name: "create_draft", arguments: VALID_PROJECTION },
      { name: "inspect_draft", arguments: { post_id: "9876543210", expected: VALID_PROJECTION } }
    ]) {
      const result = await client.callTool(request);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toEqual([{ type: "text", text: "Unexpected internal tool failure." }]);
      expect(JSON.stringify(result)).not.toContain(secretMarker);
    }
    expect(diagnostics).toEqual(["unexpected internal defect", "unexpected internal defect"]);
  });
});
