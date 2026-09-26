import { describe, expect, it } from "vitest";
import { verifyRemotePost } from "../../src/domain/verify.js";
import { BLOG_ID, matchingPost, VALID_PROJECTION } from "../helpers/fake-adapter.js";

describe("six-check verifier", () => {
  it("returns six independently visible matches for the exact projection", () => {
    const result = verifyRemotePost(BLOG_ID, VALID_PROJECTION, matchingPost());
    expect(result.checks.map(check => check.name)).toEqual([
      "target", "status", "title", "body", "labels", "provenance"
    ]);
    expect(result.checks.every(check => check.result === "MATCH")).toBe(true);
  });

  it.each([
    ["target", { blogId: "different" }],
    ["status", { status: "LIVE" }],
    ["title", { title: "different" }],
    ["body", { content: "<p>different</p>" }],
    ["labels", { labels: ["evidence"] }],
    ["provenance", { customMetaData: '{"schema_version":1,"artifact_id":"different","version_id":"version-7"}' }]
  ])("marks %s mismatch without collapsing other evidence", (name, overrides) => {
    const result = verifyRemotePost(BLOG_ID, VALID_PROJECTION, matchingPost(overrides));
    expect(result.checks.find(check => check.name === name)?.result).toBe("MISMATCH");
  });

  it("treats missing or unsupported facts as unknown", () => {
    const result = verifyRemotePost(BLOG_ID, VALID_PROJECTION, matchingPost({ content: "<div>unknown</div>" }));
    expect(result.checks.find(check => check.name === "body")?.result).toBe("UNKNOWN");
  });
});
