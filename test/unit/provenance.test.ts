import { describe, expect, it } from "vitest";
import {
  createProvenanceRecord,
  decodeProvenanceStore,
  emptyProvenanceStore,
  encodeProvenanceStore,
  provenanceKey
} from "../../src/domain/provenance.js";

describe("provenance store schema", () => {
  it("preserves top-level and record-level schema version 1", () => {
    const record = createProvenanceRecord("123", "456", "artifact", "version");
    const store = emptyProvenanceStore();
    store.records[provenanceKey("123", "456")] = record;

    expect(decodeProvenanceStore(encodeProvenanceStore(store))).toEqual({ ok: true, store });
    expect(store).toEqual({
      schema_version: 1,
      records: {
        "123:456": {
          schema_version: 1,
          blog_id: "123",
          post_id: "456",
          artifact_id: "artifact",
          version_id: "version"
        }
      }
    });
  });

  it.each([
    ['{"schema_version":2,"records":{}}', "PROVENANCE_SCHEMA_UNSUPPORTED"],
    ['{"schema_version":1,"records":{"123:456":{"schema_version":2,"blog_id":"123","post_id":"456","artifact_id":"a","version_id":"v"}}}', "PROVENANCE_SCHEMA_UNSUPPORTED"],
    ["not-json", "PROVENANCE_STORE_CORRUPT"],
    ['{"schema_version":1,"records":{},"extra":true}', "PROVENANCE_STORE_CORRUPT"],
    ['{"schema_version":1,"records":{"123:456":{"schema_version":1,"blog_id":"123","post_id":"999","artifact_id":"a","version_id":"v"}}}', "PROVENANCE_KEY_INTEGRITY_CONFLICT"]
  ])("classifies strict-schema failure %s", (contents, code) => {
    expect(decodeProvenanceStore(contents)).toMatchObject({ ok: false, code });
  });
});
