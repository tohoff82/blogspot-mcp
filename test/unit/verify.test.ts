import { describe, expect, it } from "vitest";
import type { ProvenanceAccessResult } from "../../src/domain/contracts.js";
import { verifyRemotePost } from "../../src/domain/verify.js";
import {
  BLOG_ID,
  matchingPost,
  matchingProvenanceRecord,
  POST_ID,
  VALID_PROJECTION
} from "../helpers/fake-adapter.js";

const provenance = (record = matchingProvenanceRecord()): ProvenanceAccessResult => ({
  ok: true,
  evidence: {
    storage: "owner_sidecar",
    key: { blog_id: BLOG_ID, post_id: POST_ID },
    record
  }
});

describe("six-check verifier", () => {
  it("returns five Blogger matches plus one separate provenance match", () => {
    const result = verifyRemotePost(BLOG_ID, VALID_PROJECTION, matchingPost(), provenance());
    expect(result.checks.map(check => check.name)).toEqual([
      "target", "status", "title", "body", "labels", "provenance"
    ]);
    expect(result.checks.every(check => check.result === "MATCH")).toBe(true);
    expect(result.remote).not.toHaveProperty("provenance");
    expect(result.provenance.record).toEqual(matchingProvenanceRecord());
  });

  it.each([
    ["target", { blogId: "different" }],
    ["status", { status: "LIVE" }],
    ["title", { title: "different" }],
    ["body", { content: "<p>different</p>" }],
    ["labels", { labels: ["evidence"] }]
  ])("marks %s mismatch without collapsing other evidence", (name, overrides) => {
    const result = verifyRemotePost(BLOG_ID, VALID_PROJECTION, matchingPost(overrides), provenance());
    expect(result.checks.find(check => check.name === name)?.result).toBe("MISMATCH");
  });

  it("maps valid different provenance to a coded MISMATCH", () => {
    const result = verifyRemotePost(
      BLOG_ID,
      VALID_PROJECTION,
      matchingPost(),
      provenance(matchingProvenanceRecord({ artifact_id: "different" }))
    );
    expect(result.checks.find(check => check.name === "provenance")).toMatchObject({
      result: "MISMATCH",
      code: "PROVENANCE_VALUE_MISMATCH"
    });
  });

  it("keeps missing Blogger facts and provenance failures UNKNOWN", () => {
    const result = verifyRemotePost(BLOG_ID, VALID_PROJECTION, matchingPost({ content: "<div>unknown</div>" }), {
      ok: false,
      code: "PROVENANCE_RECORD_ABSENT",
      detail: "bounded absent-record detail",
      evidence: { storage: "owner_sidecar", key: { blog_id: BLOG_ID, post_id: POST_ID } }
    });
    expect(result.checks.find(check => check.name === "body")?.result).toBe("UNKNOWN");
    expect(result.checks.find(check => check.name === "provenance")).toMatchObject({
      result: "UNKNOWN",
      code: "PROVENANCE_RECORD_ABSENT"
    });
  });
});
