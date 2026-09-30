import { describe, expect, it } from "vitest";
import { inspectDraft } from "../../src/tools/inspect-draft.js";
import {
  BLOG_ID,
  FakeAdapter,
  FakeProvenanceStore,
  matchingPost,
  matchingProvenanceRecord,
  POST_ID,
  VALID_PROJECTION
} from "../helpers/fake-adapter.js";

describe("inspect_draft orchestration", () => {
  it("reads Blogger and provenance without writing and returns VERIFIED", async () => {
    const adapter = new FakeAdapter();
    const provenanceStore = new FakeProvenanceStore();
    const result = await inspectDraft(
      { post_id: POST_ID, expected: VALID_PROJECTION },
      { blogId: BLOG_ID, adapter, provenanceStore }
    );
    expect(result.outcome).toBe("VERIFIED");
    expect(adapter.inserts).toHaveLength(0);
    expect(adapter.gets).toEqual([POST_ID]);
    expect(provenanceStore.persists).toHaveLength(0);
    expect(provenanceStore.lookups).toEqual([{ blogId: BLOG_ID, postId: POST_ID }]);
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.remote).not.toHaveProperty("provenance");
    expect(result.provenance?.record).toEqual(matchingProvenanceRecord());
  });

  it("returns MISMATCH with independently visible evidence", async () => {
    const adapter = new FakeAdapter(
      { ok: true, postId: "unused" },
      { ok: true, post: matchingPost({ status: "LIVE" }) }
    );
    const provenanceStore = new FakeProvenanceStore();
    const result = await inspectDraft(
      { post_id: POST_ID, expected: VALID_PROJECTION },
      { blogId: BLOG_ID, adapter, provenanceStore }
    );
    expect(result.outcome).toBe("MISMATCH");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.checks?.find(check => check.name === "status")).toMatchObject({ result: "MISMATCH" });
    expect(adapter.inserts).toHaveLength(0);
  });

  it("maps valid different provenance to MISMATCH", async () => {
    const provenanceStore = new FakeProvenanceStore();
    provenanceStore.records.set(`${BLOG_ID}:${POST_ID}`, matchingProvenanceRecord({ version_id: "other" }));
    const result = await inspectDraft(
      { post_id: POST_ID, expected: VALID_PROJECTION },
      { blogId: BLOG_ID, adapter: new FakeAdapter(), provenanceStore }
    );
    expect(result.outcome).toBe("MISMATCH");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.error).toMatchObject({ code: "PROVENANCE_VALUE_MISMATCH", phase: "provenance" });
  });

  it("maps unknown provenance to REMOTE_UNKNOWN unless another check mismatches", async () => {
    const unknownStore = new FakeProvenanceStore(undefined, {
      ok: false,
      code: "PROVENANCE_STORE_CORRUPT",
      detail: "bounded corrupt-store diagnostic",
      evidence: { storage: "owner_sidecar", key: { blog_id: BLOG_ID, post_id: POST_ID } }
    });
    const unknown = await inspectDraft(
      { post_id: POST_ID, expected: VALID_PROJECTION },
      { blogId: BLOG_ID, adapter: new FakeAdapter(), provenanceStore: unknownStore }
    );
    expect(unknown.outcome).toBe("REMOTE_UNKNOWN");
    if (unknown.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(unknown.error).toMatchObject({ code: "PROVENANCE_STORE_CORRUPT", phase: "provenance" });

    const mismatch = await inspectDraft(
      { post_id: POST_ID, expected: VALID_PROJECTION },
      {
        blogId: BLOG_ID,
        adapter: new FakeAdapter(
          { ok: true, postId: "unused" },
          { ok: true, post: matchingPost({ title: "changed" }) }
        ),
        provenanceStore: unknownStore
      }
    );
    expect(mismatch.outcome).toBe("MISMATCH");
  });

  it("keeps absent, access denied, and remote unknown distinct without provenance access", async () => {
    for (const [kind, outcome] of [
      ["absent", "ABSENT"],
      ["access_denied", "ACCESS_DENIED"],
      ["unknown", "REMOTE_UNKNOWN"]
    ] as const) {
      const adapter = new FakeAdapter(
        { ok: true, postId: "unused" },
        { ok: false, kind, code: kind.toUpperCase(), detail: "bounded diagnostic" }
      );
      const provenanceStore = new FakeProvenanceStore();
      const result = await inspectDraft(
        { post_id: POST_ID, expected: VALID_PROJECTION },
        { blogId: BLOG_ID, adapter, provenanceStore }
      );
      expect(result.outcome).toBe(outcome);
      expect(adapter.inserts).toHaveLength(0);
      expect(provenanceStore.lookups).toHaveLength(0);
    }
  });

  it("validates both post identity and expected projection before reading", async () => {
    const adapter = new FakeAdapter();
    const provenanceStore = new FakeProvenanceStore();
    const result = await inspectDraft(
      { post_id: "not-decimal", expected: { ...VALID_PROJECTION, title: "" } },
      { blogId: BLOG_ID, adapter, provenanceStore }
    );
    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(adapter.gets).toHaveLength(0);
    expect(provenanceStore.lookups).toHaveLength(0);
  });
});
