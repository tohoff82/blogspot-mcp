import type {
  AuthoredProjection,
  RemotePost,
  RemotePostEvidence,
  VerificationCheck
} from "./contracts.js";
import { decodeBody } from "./body-codec.js";
import { decodeProvenance } from "./provenance.js";

export type VerificationResult = {
  remote: RemotePostEvidence;
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
  post: RemotePost
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

  const expectedProvenance = {
    schema_version: 1 as const,
    artifact_id: expected.source.artifact_id,
    version_id: expected.source.version_id
  };
  if (post.customMetaData === undefined) {
    checks.push({ name: "provenance", result: "UNKNOWN", expected: expectedProvenance, detail: "customMetaData was not present in the remote response." });
  } else {
    const provenance = decodeProvenance(post.customMetaData);
    if (!provenance.ok) {
      checks.push({ name: "provenance", result: "UNKNOWN", expected: expectedProvenance, detail: provenance.detail });
    } else {
      remote.provenance = provenance.provenance;
      const matches = provenance.provenance.artifact_id === expectedProvenance.artifact_id
        && provenance.provenance.version_id === expectedProvenance.version_id;
      checks.push({
        name: "provenance",
        result: matches ? "MATCH" : "MISMATCH",
        expected: expectedProvenance,
        observed: provenance.provenance
      });
    }
  }

  return { remote, checks };
}
