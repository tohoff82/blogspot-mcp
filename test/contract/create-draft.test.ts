import { describe, expect, it } from "vitest";
import { createDraft } from "../../src/tools/create-draft.js";
import { encodeBody } from "../../src/domain/body-codec.js";
import { encodeProvenance } from "../../src/domain/provenance.js";
import { BLOG_ID, FakeAdapter, matchingPost, VALID_PROJECTION } from "../helpers/fake-adapter.js";

describe("create_draft orchestration", () => {
  it("creates once, reads back once, and returns VERIFIED evidence", async () => {
    const adapter = new FakeAdapter();
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter });

    expect(result.outcome).toBe("VERIFIED");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(adapter.inserts).toEqual([{
      title: VALID_PROJECTION.title,
      content: encodeBody(VALID_PROJECTION.body),
      labels: VALID_PROJECTION.labels,
      customMetaData: encodeProvenance("artifact-123", "version-7")
    }]);
    expect(adapter.gets).toEqual(["9876543210"]);
    expect(result.checks).toHaveLength(6);
    expect(result.remote_effect).toBe("created");
    expect(result.retry_safe).toBe(false);
  });

  it("returns structured validation failure before any adapter call", async () => {
    const adapter = new FakeAdapter();
    const result = await createDraft({ title: 42 }, { blogId: BLOG_ID, adapter });

    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(adapter.inserts).toHaveLength(0);
    expect(adapter.gets).toHaveLength(0);
    expect(result.remote_effect).toBe("none");
    expect(result.retry_safe).toBe(true);
  });

  it.each([
    ["target", { blogId: "999" }],
    ["status", { status: "LIVE" }],
    ["title", { title: "changed" }],
    ["body", { content: "<p>changed</p>" }],
    ["labels", { labels: ["extra", ...VALID_PROJECTION.labels] }],
    ["provenance", { customMetaData: '{"schema_version":1,"artifact_id":"other","version_id":"version-7"}' }]
  ])("does not verify a %s mismatch", async (name, overrides) => {
    const adapter = new FakeAdapter(
      { ok: true, postId: "9876543210" },
      { ok: true, post: matchingPost(overrides) }
    );
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter });
    expect(result.outcome).toBe("MISMATCH");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.checks?.find(check => check.name === name)?.result).toBe("MISMATCH");
    expect(adapter.inserts).toHaveLength(1);
  });

  it("never retries an unknown create effect", async () => {
    const adapter = new FakeAdapter({
      ok: false,
      kind: "unknown",
      code: "POST_TIMEOUT",
      detail: "The insert timed out after the attempt boundary."
    });
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter });
    expect(result).toMatchObject({
      outcome: "REMOTE_EFFECT_UNKNOWN",
      remote_effect: "unknown",
      retry_safe: false
    });
    expect(adapter.inserts).toHaveLength(1);
    expect(adapter.gets).toHaveLength(0);
  });
});
