import type {
  AuthoredProjection,
  ProvenanceAccessResult,
  ProvenanceEvidence,
  RemotePost,
  RemotePostEvidence,
  VerificationCheck
} from "./contracts.js";
import { decodeBody } from "./body-codec.js";
import { createProvenanceRecord } from "./provenance.js";

export type VerificationResult = {
  remote: RemotePostEvidence;
  provenance: ProvenanceEvidence;
  checks: VerificationCheck[];
};

function scalarCheck(
  name: VerificationCheck["name"],
  expected: unknown,
  observed: unknown
): VerificationCheck {
  if (observed === undefined) {
    return { name, result: "UNKNOWN", expected, detail: `${name} was not present in the remote response.` };
  }
  return { name, result: Object.is(expected, observed) ? "MATCH" : "MISMATCH", expected, observed };
}

function sameStringSet(expected: string[], observed: string[]): boolean {
  if (expected.length !== observed.length) return false;
  const expectedSet = new Set(expected);
  return expectedSet.size === observed.length && observed.every(label => expectedSet.has(label));
}

export function verifyRemotePost(
  configuredBlogId: string,
  expected: AuthoredProjection,
  post: RemotePost,
  provenanceResult: ProvenanceAccessResult
): VerificationResult {
  const remote: RemotePostEvidence = { post_id: post.id };
  if (post.blogId !== undefined) remote.blog_id = post.blogId;
  if (post.status !== undefined) remote.status = post.status;
  if (post.title !== undefined) remote.title = post.title;
  if (post.labels !== undefined) remote.labels = [...post.labels];

  const checks: VerificationCheck[] = [
    scalarCheck("target", configuredBlogId, post.blogId),
    scalarCheck("status", "DRAFT", post.status),
    scalarCheck("title", expected.title, post.title)
  ];

  if (post.content === undefined) {
    checks.push({ name: "body", result: "UNKNOWN", expected: expected.body, detail: "content was not present in the remote response." });
  } else {
    const body = decodeBody(post.content);
    if (!body.ok) {
      checks.push({ name: "body", result: "UNKNOWN", expected: expected.body, detail: body.detail });
    } else {
      remote.canonical_body = body.canonicalBody;
      checks.push(scalarCheck("body", expected.body, body.canonicalBody));
    }
  }

  const expectedLabels = expected.labels ?? [];
  if (post.labels === undefined) {
    checks.push({ name: "labels", result: "UNKNOWN", expected: expectedLabels, detail: "labels were not present in the remote response." });
  } else {
    checks.push({
      name: "labels",
      result: sameStringSet(expectedLabels, post.labels) ? "MATCH" : "MISMATCH",
      expected: expectedLabels,
      observed: post.labels
    });
  }

  const expectedProvenance = createProvenanceRecord(
    configuredBlogId,
    provenanceResult.evidence.key.post_id,
    expected.source.artifact_id,
    expected.source.version_id
  );
  if (!provenanceResult.ok) {
    checks.push({
      name: "provenance",
      result: "UNKNOWN",
      expected: expectedProvenance,
      code: provenanceResult.code,
      detail: provenanceResult.detail
    });
  } else {
    const observed = provenanceResult.evidence.record;
    if (observed === undefined) {
      checks.push({
        name: "provenance",
        result: "UNKNOWN",
        expected: expectedProvenance,
        code: "PROVENANCE_RECORD_ABSENT",
        detail: "The provenance lookup returned no record."
      });
    } else {
      const matches = observed.artifact_id === expectedProvenance.artifact_id
        && observed.version_id === expectedProvenance.version_id;
      checks.push({
        name: "provenance",
        result: matches ? "MATCH" : "MISMATCH",
        expected: expectedProvenance,
        observed,
        ...(matches ? {} : { code: "PROVENANCE_VALUE_MISMATCH" as const })
      });
    }
  }

  return { remote, provenance: provenanceResult.evidence, checks };
}
