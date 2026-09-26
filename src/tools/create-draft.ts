import { encodeBody } from "../domain/body-codec.js";
import type {
  BloggerAdapter,
  CreateDraftIngress,
  CreateDraftResult
} from "../domain/contracts.js";
import { classifyChecks } from "../domain/outcomes.js";
import { validateProjection } from "../domain/projection.js";
import { encodeProvenance } from "../domain/provenance.js";
import { verifyRemotePost } from "../domain/verify.js";

export type CreateDraftDependencies = {
  blogId: string;
  adapter: BloggerAdapter;
};

export async function createDraft(
  ingress: CreateDraftIngress,
  dependencies: CreateDraftDependencies
): Promise<CreateDraftResult> {
  const validated = validateProjection(ingress);
  if (!validated.ok) {
    return {
      action: "create_draft",
      outcome: "VALIDATION_FAILED",
      message: "The authored projection is invalid; Blogger was not contacted.",
      target: { blog_id: dependencies.blogId },
      requested_raw: ingress,
      issues: validated.issues,
      remote_effect: "none",
      retry_safe: true,
      error: {
        code: "INPUT_VALIDATION_FAILED",
        phase: "validation",
        detail: "Correct the reported fields before retrying."
      }
    };
  }

  const requested = validated.value;
  const insert = await dependencies.adapter.insertDraft({
    title: requested.title,
    content: encodeBody(requested.body),
    labels: requested.labels ?? [],
    customMetaData: encodeProvenance(requested.source.artifact_id, requested.source.version_id)
  });

  if (!insert.ok) {
    if (insert.kind === "unknown") {
      return {
        action: "create_draft",
        outcome: "REMOTE_EFFECT_UNKNOWN",
        message: "The create attempt had an unknown remote effect; do not retry blindly.",
        target: { blog_id: dependencies.blogId },
        requested,
        remote_effect: "unknown",
        retry_safe: false,
        error: { code: insert.code, phase: "create", detail: insert.detail }
      };
    }
    return {
      action: "create_draft",
      outcome: "CREATE_FAILED",
      message: "Blogger did not create a draft.",
      target: { blog_id: dependencies.blogId },
      requested,
      remote_effect: "none",
      retry_safe: true,
      error: {
        code: insert.code,
        phase: insert.kind === "auth" ? "auth" : "create",
        detail: insert.detail
      }
    };
  }

  if (insert.postId === undefined) {
    return {
      action: "create_draft",
      outcome: "CREATED_UNVERIFIED",
      message: "Blogger accepted the draft, but no post identity was available for read-back.",
      target: { blog_id: dependencies.blogId },
      requested,
      remote_effect: "created",
      retry_safe: false,
      error: {
        code: "POST_ID_MISSING",
        phase: "read_back",
        detail: "The successful insert response did not provide a usable post ID."
      }
    };
  }

  const readBack = await dependencies.adapter.getPostAdmin(insert.postId);
  if (!readBack.ok) {
    return {
      action: "create_draft",
      outcome: "CREATED_UNVERIFIED",
      message: "A draft identity is known, but read-back could not establish its contents.",
      target: { blog_id: dependencies.blogId },
      requested,
      remote_effect: "created",
      retry_safe: false,
      remote: { post_id: insert.postId },
      error: {
        code: readBack.code,
        phase: readBack.kind === "auth" ? "auth" : "read_back",
        detail: readBack.detail
      }
    };
  }

  const verification = verifyRemotePost(dependencies.blogId, requested, readBack.post);
  const classification = classifyChecks(verification.checks);
  if (classification === "VERIFIED") {
    return {
      action: "create_draft",
      outcome: "VERIFIED",
      message: "The private Blogger draft was created, read back, and fully verified.",
      target: { blog_id: dependencies.blogId },
      requested,
      remote_effect: "created",
      retry_safe: false,
      remote: verification.remote,
      checks: verification.checks
    };
  }
  if (classification === "MISMATCH") {
    return {
      action: "create_draft",
      outcome: "MISMATCH",
      message: "The created draft differs materially from the requested projection.",
      target: { blog_id: dependencies.blogId },
      requested,
      remote_effect: "created",
      retry_safe: false,
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
    action: "create_draft",
    outcome: "CREATED_UNVERIFIED",
    message: "The draft exists, but at least one required verification fact is unknown.",
    target: { blog_id: dependencies.blogId },
    requested,
    remote_effect: "created",
    retry_safe: false,
    remote: verification.remote,
    checks: verification.checks,
    error: {
      code: "VERIFICATION_INCONCLUSIVE",
      phase: "verification",
      detail: "At least one material verification check could not be established."
    }
  };
}
