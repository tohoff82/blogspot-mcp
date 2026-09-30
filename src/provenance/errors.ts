import type {
  ProvenanceAccessFailure,
  ProvenanceErrorCode,
  ProvenanceEvidence
} from "../domain/contracts.js";

export function provenanceFailure(
  evidence: ProvenanceEvidence,
  code: ProvenanceErrorCode,
  detail: string
): ProvenanceAccessFailure {
  return { ok: false, code, detail, evidence };
}
