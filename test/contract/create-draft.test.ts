import { describe, expect, it } from "vitest";
import { createDraft } from "../../src/tools/create-draft.js";
import { encodeBody } from "../../src/domain/body-codec.js";
import type { BloggerAdapter, ProvenanceStore } from "../../src/domain/contracts.js";
import {
  BLOG_ID,
  FakeAdapter,
  FakeProvenanceStore,
  matchingPost,
  matchingProvenanceRecord,
  POST_ID,
  VALID_PROJECTION
} from "../helpers/fake-adapter.js";

const failureEvidence = {
  storage: "owner_sidecar" as const,
  key: { blog_id: BLOG_ID, post_id: POST_ID }
};

describe("create_draft orchestration", () => {
  it("creates, persists, reads back, re-reads provenance, and returns separate VERIFIED evidence", async () => {
    const events: string[] = [];
    const baseAdapter = new FakeAdapter();
    const baseStore = new FakeProvenanceStore();
    const adapter: BloggerAdapter = {
      async insertDraft(request) {
        events.push("insert");
        return baseAdapter.insertDraft(request);
      },
      async getPostAdmin(postId) {
        events.push("admin-read");
        return baseAdapter.getPostAdmin(postId);
      }
    };
    const provenanceStore: ProvenanceStore = {
      async persist(record) {
        events.push("provenance-persist");
        return baseStore.persist(record);
      },
      async lookup(blogId, postId) {
        events.push("provenance-reread");
        return baseStore.lookup(blogId, postId);
      }
    };
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter, provenanceStore });

    expect(result.outcome).toBe("VERIFIED");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(events).toEqual(["insert", "provenance-persist", "admin-read", "provenance-reread"]);
    expect(baseAdapter.inserts).toEqual([{
      title: VALID_PROJECTION.title,
      content: encodeBody(VALID_PROJECTION.body),
      labels: VALID_PROJECTION.labels
    }]);
    expect(JSON.stringify(baseAdapter.inserts)).not.toContain("customMetaData");
    expect(baseAdapter.gets).toEqual([POST_ID]);
    expect(baseStore.persists).toEqual([matchingProvenanceRecord()]);
    expect(baseStore.lookups).toEqual([{ blogId: BLOG_ID, postId: POST_ID }]);
    expect(result.checks).toHaveLength(6);
    expect(result.remote).not.toHaveProperty("provenance");
    expect(result.provenance?.record).toEqual(matchingProvenanceRecord());
    expect(result.remote_effect).toBe("created");
    expect(result.retry_safe).toBe(false);
  });

  it("returns structured validation failure before adapter or provenance access", async () => {
    const adapter = new FakeAdapter();
    const provenanceStore = new FakeProvenanceStore();
    const result = await createDraft({ title: 42 }, { blogId: BLOG_ID, adapter, provenanceStore });

    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(adapter.inserts).toHaveLength(0);
    expect(adapter.gets).toHaveLength(0);
    expect(provenanceStore.persists).toHaveLength(0);
    expect(provenanceStore.lookups).toHaveLength(0);
    expect(result.remote_effect).toBe("none");
    expect(result.retry_safe).toBe(true);
  });

  it.each([
    ["target", { blogId: "999" }],
    ["status", { status: "LIVE" }],
    ["title", { title: "changed" }],
    ["body", { content: "<p>changed</p>" }],
    ["labels", { labels: ["extra", ...VALID_PROJECTION.labels] }]
  ])("does not verify a %s Blogger mismatch", async (name, overrides) => {
    const adapter = new FakeAdapter(
      { ok: true, postId: POST_ID },
      { ok: true, post: matchingPost(overrides) }
    );
    const provenanceStore = new FakeProvenanceStore();
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter, provenanceStore });
    expect(result.outcome).toBe("MISMATCH");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.checks?.find(check => check.name === name)?.result).toBe("MISMATCH");
    expect(adapter.inserts).toHaveLength(1);
  });

  it("treats a valid non-overwritten provenance value difference as MISMATCH", async () => {
    const adapter = new FakeAdapter();
    const provenanceStore = new FakeProvenanceStore();
    provenanceStore.records.set(`${BLOG_ID}:${POST_ID}`, matchingProvenanceRecord({ artifact_id: "other" }));
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter, provenanceStore });

    expect(result.outcome).toBe("MISMATCH");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.checks?.find(check => check.name === "provenance")).toMatchObject({
      result: "MISMATCH",
      code: "PROVENANCE_VALUE_MISMATCH"
    });
    expect(result.error).toMatchObject({
      code: "PROVENANCE_VALUE_MISMATCH",
      phase: "provenance"
    });
  });

  it("continues ADMIN read-back after persistence failure and maps unknown provenance", async () => {
    const adapter = new FakeAdapter();
    const provenanceStore = new FakeProvenanceStore({
      ok: false,
      code: "PROVENANCE_WRITE_FAILED",
      detail: "bounded persistence failure",
      evidence: failureEvidence
    });
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter, provenanceStore });

    expect(adapter.gets).toEqual([POST_ID]);
    expect(provenanceStore.lookups).toEqual([{ blogId: BLOG_ID, postId: POST_ID }]);
    expect(result.outcome).toBe("CREATED_UNVERIFIED");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.checks?.find(check => check.name === "provenance")).toMatchObject({
      result: "UNKNOWN",
      code: "PROVENANCE_WRITE_FAILED"
    });
    expect(result.error).toMatchObject({ code: "PROVENANCE_WRITE_FAILED", phase: "provenance" });
  });

  it("lets a confirmed Blogger mismatch dominate unknown provenance", async () => {
    const adapter = new FakeAdapter(
      { ok: true, postId: POST_ID },
      { ok: true, post: matchingPost({ status: "LIVE" }) }
    );
    const provenanceStore = new FakeProvenanceStore({
      ok: false,
      code: "PROVENANCE_WRITE_FAILED",
      detail: "bounded persistence failure",
      evidence: failureEvidence
    });
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter, provenanceStore });

    expect(result.outcome).toBe("MISMATCH");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.error).toMatchObject({ code: "VERIFICATION_MISMATCH", phase: "verification" });
  });

  it.each([
    [{ ok: false, kind: "unknown", code: "POST_TIMEOUT", detail: "unknown effect" }, "REMOTE_EFFECT_UNKNOWN"],
    [{ ok: false, kind: "definitive", code: "BLOGGER_HTTP_403", detail: "definitive failure" }, "CREATE_FAILED"],
    [{ ok: true }, "CREATED_UNVERIFIED"]
  ] as const)("keeps insert attempts at one for %s", async (insertResult, outcome) => {
    const adapter = new FakeAdapter(insertResult);
    const provenanceStore = new FakeProvenanceStore();
    const result = await createDraft(VALID_PROJECTION, { blogId: BLOG_ID, adapter, provenanceStore });
    expect(result.outcome).toBe(outcome);
    expect(adapter.inserts).toHaveLength(1);
    expect(provenanceStore.persists).toHaveLength(0);
  });
});
