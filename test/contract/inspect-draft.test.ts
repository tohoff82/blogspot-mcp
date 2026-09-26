import { describe, expect, it } from "vitest";
import { inspectDraft } from "../../src/tools/inspect-draft.js";
import { BLOG_ID, FakeAdapter, matchingPost, VALID_PROJECTION } from "../helpers/fake-adapter.js";

describe("inspect_draft orchestration", () => {
  it("reads only and returns VERIFIED", async () => {
    const adapter = new FakeAdapter();
    const result = await inspectDraft(
      { post_id: "9876543210", expected: VALID_PROJECTION },
      { blogId: BLOG_ID, adapter }
    );
    expect(result.outcome).toBe("VERIFIED");
    expect(adapter.inserts).toHaveLength(0);
    expect(adapter.gets).toEqual(["9876543210"]);
  });

  it("returns MISMATCH with independently visible evidence", async () => {
    const adapter = new FakeAdapter(
      { ok: true, postId: "unused" },
      { ok: true, post: matchingPost({ status: "LIVE" }) }
    );
    const result = await inspectDraft(
      { post_id: "9876543210", expected: VALID_PROJECTION },
      { blogId: BLOG_ID, adapter }
    );
    expect(result.outcome).toBe("MISMATCH");
    if (result.outcome === "VALIDATION_FAILED") throw new Error("Expected validated result.");
    expect(result.checks?.find(check => check.name === "status")).toMatchObject({ result: "MISMATCH" });
    expect(adapter.inserts).toHaveLength(0);
  });

  it("keeps absent, access denied, and unknown distinct", async () => {
    for (const [kind, outcome] of [
      ["absent", "ABSENT"],
      ["access_denied", "ACCESS_DENIED"],
      ["unknown", "REMOTE_UNKNOWN"]
    ] as const) {
      const adapter = new FakeAdapter(
        { ok: true, postId: "unused" },
        { ok: false, kind, code: kind.toUpperCase(), detail: "bounded diagnostic" }
      );
      const result = await inspectDraft(
        { post_id: "9876543210", expected: VALID_PROJECTION },
        { blogId: BLOG_ID, adapter }
      );
      expect(result.outcome).toBe(outcome);
      expect(adapter.inserts).toHaveLength(0);
    }
  });

  it("validates both post identity and expected projection before reading", async () => {
    const adapter = new FakeAdapter();
    const result = await inspectDraft(
      { post_id: "not-decimal", expected: { ...VALID_PROJECTION, title: "" } },
      { blogId: BLOG_ID, adapter }
    );
    expect(result.outcome).toBe("VALIDATION_FAILED");
    expect(adapter.gets).toHaveLength(0);
  });
});
