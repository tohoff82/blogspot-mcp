import { describe, expect, it } from "vitest";
import { createRuntimeCredentialProvider } from "../../src/auth/oauth-client.js";
import { BloggerRestAdapter } from "../../src/blogger/adapter.js";
import { loadConfig } from "../../src/config.js";
import type { BloggerAdapter, InsertDraftRequest, InsertDraftResult } from "../../src/domain/contracts.js";
import { validateProjection } from "../../src/domain/projection.js";
import { createDraft } from "../../src/tools/create-draft.js";
import { inspectDraft } from "../../src/tools/inspect-draft.js";

describe.runIf(process.env.BLOGGER_LIVE_TEST === "1")("single-attempt live Blogger gate", () => {
  it("creates exactly one private draft and independently verifies the boundary payload", async () => {
    const config = await loadConfig({ mode: "runtime" });
    const provider = await createRuntimeCredentialProvider(config);
    const realAdapter = new BloggerRestAdapter(config.blogId, provider);
    let insertAttempts = 0;
    const adapter: BloggerAdapter = {
      async insertDraft(request: InsertDraftRequest): Promise<InsertDraftResult> {
        insertAttempts += 1;
        return realAdapter.insertDraft(request);
      },
      getPostAdmin: postId => realAdapter.getPostAdmin(postId)
    };

    const runId = new Date().toISOString().replaceAll(/[^0-9]/gu, "");
    const expected = {
      title: `blogspot-mcp live gate ${runId}`,
      body: "First & second\ncontinued line\n\nNext <paragraph> with \"quotes\" and 'apostrophe'.",
      labels: Array.from({ length: 20 }, (_, index) => `label${String(index).padStart(5, "0")}`),
      source: {
        artifact_id: "blogspot-mcp-live-gate",
        version_id: runId
      }
    };
    const localValidation = validateProjection(expected);
    expect(localValidation.ok).toBe(true);
    expect(expected.labels).toHaveLength(20);
    expect(expected.labels.reduce((total, label) => total + Array.from(label).length, 0)).toBe(200);

    const created = await createDraft(expected, { blogId: config.blogId, adapter });
    expect(insertAttempts).toBe(1);
    if (created.outcome !== "VALIDATION_FAILED" && created.remote?.post_id !== undefined) {
      process.stderr.write(`LIVE_GATE_POST_ID=${created.remote.post_id}\n`);
    }
    expect(created.outcome).toBe("VERIFIED");
    if (created.outcome === "VALIDATION_FAILED" || created.remote?.post_id === undefined) {
      throw new Error("Live gate did not return a known post identity.");
    }
    expect(created.remote.status).toBe("DRAFT");
    expect(created.remote.blog_id).toBe(config.blogId);
    expect(created.checks).toHaveLength(6);
    expect(created.checks?.every(check => check.result === "MATCH")).toBe(true);
    expect(created.remote.provenance).toEqual({
      schema_version: 1,
      artifact_id: expected.source.artifact_id,
      version_id: expected.source.version_id
    });

    const inspected = await inspectDraft(
      { post_id: created.remote.post_id, expected },
      { blogId: config.blogId, adapter }
    );
    expect(inspected.outcome).toBe("VERIFIED");
    expect(insertAttempts).toBe(1);
  }, 60_000);
});
