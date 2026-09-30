import { z } from "zod";
import {
  provenanceRecordSchema,
  type ProvenanceErrorCode,
  type ProvenanceRecord
} from "./contracts.js";

export type ProvenanceStoreDocument = {
  schema_version: 1;
  records: Record<string, ProvenanceRecord>;
};

export type ProvenanceStoreDecodeResult =
  | { ok: true; store: ProvenanceStoreDocument }
  | { ok: false; code: ProvenanceErrorCode; detail: string };

const decimalIdSchema = z.string().regex(/^\d+$/u);

export function provenanceKey(blogId: string, postId: string): string {
  if (!decimalIdSchema.safeParse(blogId).success || !decimalIdSchema.safeParse(postId).success) {
    throw new Error("Provenance key IDs must be decimal strings.");
  }
  return `${blogId}:${postId}`;
}

export function createProvenanceRecord(
  blogId: string,
  postId: string,
  artifactId: string,
  versionId: string
): ProvenanceRecord {
  return provenanceRecordSchema.parse({
    schema_version: 1,
    blog_id: blogId,
    post_id: postId,
    artifact_id: artifactId,
    version_id: versionId
  });
}

export function emptyProvenanceStore(): ProvenanceStoreDocument {
  return { schema_version: 1, records: {} };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function decodeProvenanceStore(contents: string): ProvenanceStoreDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return {
      ok: false,
      code: "PROVENANCE_STORE_CORRUPT",
      detail: "The provenance store is not valid JSON."
    };
  }

  if (!isObject(parsed)) {
    return {
      ok: false,
      code: "PROVENANCE_STORE_CORRUPT",
      detail: "The provenance store root must be an object."
    };
  }
  if (parsed.schema_version !== 1) {
    return typeof parsed.schema_version === "number"
      ? {
          ok: false,
          code: "PROVENANCE_SCHEMA_UNSUPPORTED",
          detail: "The provenance store schema version is unsupported."
        }
      : {
          ok: false,
          code: "PROVENANCE_STORE_CORRUPT",
          detail: "The provenance store schema version is missing or malformed."
        };
  }
  if (!isObject(parsed.records) || Object.keys(parsed).some(key => key !== "schema_version" && key !== "records")) {
    return {
      ok: false,
      code: "PROVENANCE_STORE_CORRUPT",
      detail: "The provenance store does not match the strict schema."
    };
  }

  const records: Record<string, ProvenanceRecord> = {};
  for (const [key, value] of Object.entries(parsed.records)) {
    if (isObject(value) && typeof value.schema_version === "number" && value.schema_version !== 1) {
      return {
        ok: false,
        code: "PROVENANCE_SCHEMA_UNSUPPORTED",
        detail: "A provenance record schema version is unsupported."
      };
    }
    const record = provenanceRecordSchema.safeParse(value);
    if (!record.success) {
      return {
        ok: false,
        code: "PROVENANCE_STORE_CORRUPT",
        detail: "A provenance record does not match the strict schema."
      };
    }
    if (key !== provenanceKey(record.data.blog_id, record.data.post_id)) {
      return {
        ok: false,
        code: "PROVENANCE_KEY_INTEGRITY_CONFLICT",
        detail: "A provenance key conflicts with its embedded blog or post ID."
      };
    }
    records[key] = record.data;
  }
  return { ok: true, store: { schema_version: 1, records } };
}

export function encodeProvenanceStore(store: ProvenanceStoreDocument): string {
  return `${JSON.stringify(store, null, 2)}\n`;
}
