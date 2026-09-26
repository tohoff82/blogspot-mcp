import { describe, expect, it } from "vitest";
import { validatePostId, validateProjection } from "../../src/domain/projection.js";
import { VALID_PROJECTION } from "../helpers/fake-adapter.js";

describe("projection validation", () => {
  it("normalizes line endings and duplicate labels without rewriting label text", () => {
    const result = validateProjection({
      ...VALID_PROJECTION,
      body: "one\r\ntwo\rthree",
      labels: ["Exact", "Exact", "exact"]
    });
    expect(result).toEqual({
      ok: true,
      value: {
        ...VALID_PROJECTION,
        body: "one\ntwo\nthree",
        labels: ["Exact", "exact"]
      }
    });
  });

  it.each([
    [{ ...VALID_PROJECTION, title: "   " }, "title", "empty"],
    [{ ...VALID_PROJECTION, body: 7 }, "body", "invalid_type"],
    [{ ...VALID_PROJECTION, labels: [" spaced"] }, "labels.0", "surrounding_whitespace"],
    [{ ...VALID_PROJECTION, labels: ["comma,label"] }, "labels.0", "comma_not_allowed"],
    [{ ...VALID_PROJECTION, labels: ["line\nbreak"] }, "labels.0", "control_character"],
    [{ ...VALID_PROJECTION, source: { artifact_id: "", version_id: "v" } }, "source.artifact_id", "empty"],
    [{ ...VALID_PROJECTION, publish: true }, "publish", "unexpected_field"]
  ])("rejects invalid input %#", (input, path, code) => {
    const result = validateProjection(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path, code })]));
  });

  it("enforces the product-owned unique-label limits by Unicode code point", () => {
    const tooMany = validateProjection({ ...VALID_PROJECTION, labels: Array.from({ length: 21 }, (_, i) => `l${i}`) });
    expect(tooMany.ok).toBe(false);
    const tooLong = validateProjection({ ...VALID_PROJECTION, labels: ["😀".repeat(201)] });
    expect(tooLong.ok).toBe(false);
  });

  it("accepts only non-empty decimal Blogger post IDs", () => {
    expect(validatePostId("12345")).toEqual({ ok: true, value: "12345" });
    expect(validatePostId("12x").ok).toBe(false);
    expect(validatePostId(12345).ok).toBe(false);
  });
});
