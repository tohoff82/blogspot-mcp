import type {
  BloggerAdapter,
  InspectDraftIngress,
  InspectDraftResult,
  ValidationIssue
} from "../domain/contracts.js";
import { classifyChecks } from "../domain/outcomes.js";
import { validatePostId, validateProjection } from "../domain/projection.js";
import { verifyRemotePost } from "../domain/verify.js";

export type InspectDraftDependencies = {
  blogId: string;
  adapter: BloggerAdapter;
};

export async function inspectDraft(
  ingress: InspectDraftIngress,
  dependencies: InspectDraftDependencies
): Promise<InspectDraftResult> {
  const postIdResult = validatePostId(ingress.post_id);
  const projectionResult = validateProjection(ingress.expected, "expected");
  if (!postIdResult.ok || !projectionResult.ok) {
    const issues: ValidationIssue[] = [];
    if (!postIdResult.ok) issues.push(...postIdResult.issues);
    if (!projectionResult.ok) issues.push(...projectionResult.issues);
    const target: { blog_id: string; post_id?: string } = { blog_id: dependencies.blogId };
    if (typeof ingress.post_id === "string") target.post_id = ingress.post_id;
    return {
      action: "inspect_draft",
      outcome: "VALIDATION_FAILED",
      message: "The inspection request is invalid; Blogger was not contacted.",
      target,
      requested_raw: ingress,
      issues,
      error: {
        code: "INPUT_VALIDATION_FAILED",
        phase: "validation",
        detail: "Correct the reported fields before retrying."
      }
    };
  }

  const postId = postIdResult.value;
  const expected = projectionResult.value;
  const result = await dependencies.adapter.getPostAdmin(postId);
  if (!result.ok) {
    const target = { blog_id: dependencies.blogId, post_id: postId };
    if (result.kind === "absent") {
      return {
        action: "inspect_draft",
        outcome: "ABSENT",
        message: "Blogger reports that the post does not exist.",
        target,
        expected,
        error: { code: result.code, phase: "read", detail: result.detail }
      };
    }
    if (result.kind === "access_denied") {
      return {
        action: "inspect_draft",
        outcome: "ACCESS_DENIED",
        message: "Blogger refused access to the requested post.",
        target,
        expected,
        error: { code: result.code, phase: "read", detail: result.detail }
      };
    }
    return {
      action: "inspect_draft",
      outcome: "REMOTE_UNKNOWN",
      message: "The current remote state could not be established.",
      target,
      expected,
      error: {
        code: result.code,
        phase: result.kind === "auth" ? "auth" : "read",
        detail: result.detail
      }
    };
  }

  const verification = verifyRemotePost(dependencies.blogId, expected, result.post);
  const classification = classifyChecks(verification.checks);
  if (classification === "VERIFIED") {
    return {
      action: "inspect_draft",
      outcome: "VERIFIED",
      message: "The remote private draft fully matches the expected projection.",
      target: { blog_id: dependencies.blogId, post_id: postId },
      expected,
      remote: verification.remote,
      checks: verification.checks
    };
  }
  if (classification === "MISMATCH") {
    return {
      action: "inspect_draft",
      outcome: "MISMATCH",
      message: "The remote post differs materially from the expected projection.",
      target: { blog_id: dependencies.blogId, post_id: postId },
      expected,
      remote: verification.remote,
      checks: verification.checks,
      error: {
        code: "VERIFICATION_MISMATCH",
        phase: "verification",
        detail: "At least one material verification check mismatched."
      }
    };
  }
  return {
    action: "inspect_draft",
    outcome: "REMOTE_UNKNOWN",
    message: "At least one required remote fact could not be established.",
    target: { blog_id: dependencies.blogId, post_id: postId },
    expected,
    remote: verification.remote,
    checks: verification.checks,
    error: {
      code: "VERIFICATION_INCONCLUSIVE",
      phase: "verification",
      detail: "At least one material verification check was unknown."
    }
  };
}
