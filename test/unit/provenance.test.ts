import { describe, expect, it } from "vitest";
import { decodeProvenance, encodeProvenance } from "../../src/domain/provenance.js";

describe("provenance codec", () => {
  it("uses stable serialization but accepts property-order differences", () => {
    expect(encodeProvenance("a", "v")).toBe('{"schema_version":1,"artifact_id":"a","version_id":"v"}');
    expect(decodeProvenance('{"version_id":"v","artifact_id":"a","schema_version":1}')).toEqual({
      ok: true,
      provenance: { schema_version: 1, artifact_id: "a", version_id: "v" }
    });
  });

  it.each([
    "not-json",
    '{"schema_version":2,"artifact_id":"a","version_id":"v"}',
    '{"schema_version":1,"artifact_id":"a","version_id":"v","publish":true}'
  ])("rejects malformed or unsupported provenance", value => {
    expect(decodeProvenance(value).ok).toBe(false);
  });
});
