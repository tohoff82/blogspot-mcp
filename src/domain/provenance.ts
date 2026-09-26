import { provenanceSchema, type Provenance } from "./contracts.js";

export type ProvenanceDecodeResult =
  | { ok: true; provenance: Provenance }
  | { ok: false; detail: string };

export function encodeProvenance(artifactId: string, versionId: string): string {
  return JSON.stringify({
    schema_version: 1,
    artifact_id: artifactId,
    version_id: versionId
  });
}

export function decodeProvenance(value: string): ProvenanceDecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, detail: "customMetaData is not valid JSON." };
  }
  const result = provenanceSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, detail: "customMetaData does not match provenance schema version 1." };
  }
  return { ok: true, provenance: result.data };
}
