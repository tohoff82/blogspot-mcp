---
doc: prd
status: approved
---

# Draft-Only Blogger MCP — Product Requirements

A small, inspectable MCP product for projecting finished text into one configured Blogger blog as a private draft and returning evidence of what actually exists remotely. Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`.

## The Core Journey

Source: `scope.md > The Core Loop`, `scope.md > What “Working” Looks Like`.

1. The caller supplies a finished title, plain-text body, optional labels, and an opaque source reference containing `artifact_id` and `version_id`.
2. The server validates the complete request before contacting Blogger. Invalid input produces a structured validation result and no remote attempt.
3. The server makes at most one attempt to create a private draft in the single configured Blogger target. The caller cannot select another blog or request another publication state.
4. Once Blogger establishes a usable post ID, the server attempts to persist the source reference in the owner-controlled provenance sidecar under the configured `blog_id + post_id`.
5. When the post ID is known, the server reads that exact post back from Blogger using ADMIN view, including when provenance persistence failed.
6. The server re-reads provenance from the sidecar, performs the six material checks across Blogger projection truth and sidecar provenance truth, and classifies the result using the accepted precedence: any confirmed `MISMATCH`, otherwise any `UNKNOWN`, otherwise all six `MATCH`.
7. At any later point, the caller can invoke the read-only inspect/verify action with a post identity and expected projection data. The server reads the current post from Blogger, looks up its durable provenance independently in the sidecar, performs the same material checks, and reports the current truth.

## Interaction Surface

Source: `scope.md > The Unique Kernel`, `scope.md > The POC Boundary`, `scope.md > Explicitly Cut`.

The product has no visual application screen. Its complete caller-visible surface consists of two MCP actions:

- **Create draft** — validates one authored payload, creates one private draft in the configured target, reads it back, verifies it, and returns structured evidence.
- **Inspect/verify** — performs a read-only retrieval of one identified post from the configured target and compares it with caller-supplied expected projection data.

No action publishes, schedules, deletes, updates, synchronizes, or selects a target blog. The exposed action list itself must make that authority boundary inspectable.

## Output Character

Source: `scope.md > Inspiration & Identity`.

Responses should feel like a focused developer tool: concise, structured, machine-branchable, and explicit about action, target, evidence, and uncertainty. Each result includes a top-level outcome and structured details, with a human-readable explanation as supporting context rather than the basis for control flow. Observed remote facts, confirmed mismatches, and facts that could not be established must remain visibly distinct.

## Input Contract

Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`.

The authored projection contains:

- `title` — required and not whitespace-only;
- `body` — required plain authored text, not whitespace-only, with paragraph breaks preserved;
- `labels` — optional and permitted to be empty;
- `source.artifact_id` — a required, opaque, non-empty string;
- `source.version_id` — a required, opaque, non-empty string.

The server does not interpret source identifiers, infer version ordering, or treat provenance as publication authorization. Duplicate labels are reduced to one unique set before the remote request. Label ordering is not meaningful. Materially invalid label values fail validation instead of being silently changed.

The configured Blogger target and required `draft` state are not caller inputs.

### Input Acceptance Criteria

- [ ] A valid title, body, label set, and source reference can enter the create journey.
- [ ] Missing or whitespace-only title or body produces `VALIDATION_FAILED` before any Blogger request.
- [ ] A missing source object, missing `artifact_id` or `version_id`, non-string identifier, or empty or whitespace-only identifier produces `VALIDATION_FAILED` before any Blogger request.
- [ ] Empty labels are accepted, and duplicate labels are normalized to a unique set before creation.
- [ ] Invalid label values produce `VALIDATION_FAILED` rather than a materially transformed remote label.
- [ ] Neither action accepts a caller-selected target blog or requested publication state.

## Create Draft Behavior

Source: `scope.md > The Core Loop`, `scope.md > What “Working” Looks Like`.

The create action is a create-once operation. “Create a draft” means creating the draft and establishing what exists remotely, not merely receiving acknowledgement of a write request. A successful write is therefore followed automatically by read-back and verification within the same caller action.

The server never creates a second draft as an automatic response to failed or inconclusive read-back. It does not locate or update an earlier draft when the same source reference is submitted again.

Once Blogger provides a usable post ID, the server attempts to persist the requested provenance under the configured `blog_id + post_id`. Provenance persistence or subsequent lookup failure makes the provenance verification check `UNKNOWN`; it does not by itself determine the top-level outcome. ADMIN read-back still occurs whenever the post ID is known, including after provenance persistence failure. After a successful ADMIN read-back and sidecar re-read, any confirmed material `MISMATCH` takes precedence over unknown provenance; otherwise any `UNKNOWN` produces `CREATED_UNVERIFIED`, and only all six `MATCH` checks produce `VERIFIED`. If ADMIN read-back itself cannot establish the created post, the existing `CREATED_UNVERIFIED` behavior remains. No sidecar persistence, lookup, locking, or integrity failure triggers another Blogger create attempt or any compensating Blogger update, delete, publish, schedule, or other mutation.

### Create Acceptance Criteria

- [ ] The server issues at most one Blogger create attempt per invocation and never automatically retries creation.
- [ ] The action reads the identified post back from Blogger before it can return `VERIFIED`.
- [ ] `VERIFIED` is returned only when every material verification check passes.
- [ ] When post identity is known, it is included in the result even if verification does not pass.
- [ ] A failure after creation does not trigger another create attempt.
- [ ] Every result distinguishes the requested source reference, configured target, known remote identity and state, verification outcome, and failure reason where those facts are available.

## Inspect and Verify Behavior

Source: `scope.md > The Core Loop`, `scope.md > What “Working” Looks Like`.

The inspect/verify action accepts:

- a Blogger post identity;
- expected title;
- expected plain-text body;
- expected labels; and
- expected `artifact_id` and `version_id`.

It retrieves the post only from the configured Blogger target and looks up provenance only under that configured `blog_id + post_id` in the owner-controlled sidecar. It then reports whether the Blogger projection and sidecar provenance correspond to the supplied expectations. The action is read-only and does not repair, update, recreate, publish, delete, or otherwise mutate either the post or provenance record.

### Inspect Acceptance Criteria

- [ ] A matching remote draft returns `VERIFIED` with structured comparison evidence.
- [ ] A readable post with any material mismatch returns `MISMATCH`, identifying the failed checks.
- [ ] A successful Blogger response establishing that the post does not exist returns `ABSENT`.
- [ ] A Blogger permission refusal returns `ACCESS_DENIED`.
- [ ] A timeout, transport failure, API failure, or other inconclusive read returns `REMOTE_UNKNOWN`.
- [ ] `ABSENT`, `ACCESS_DENIED`, and `REMOTE_UNKNOWN` are never presented as confirmed content mismatch or successful verification.

## Verification Semantics

Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`.

Verification passes only when all of these properties are established:

- the post exists and is readable;
- the post belongs to the configured Blogger target;
- its remote state is private draft;
- its title matches the expected title;
- its body is equivalent to the deterministic representation derived from the expected plain text;
- its labels contain exactly the expected unique labels, regardless of order; and
- its durable provenance matches the expected `artifact_id` and `version_id`.

Blogger is the projection truth for post identity, target, state, title, body, and labels. The owner-controlled sidecar is the provenance truth for `artifact_id` and `version_id`. A missing, unreadable, corrupt, unsupported, locked, or integrity-conflicted sidecar state makes the provenance check `UNKNOWN`; it does not fabricate a mismatch. A valid record for the same `blog_id + post_id` with different artifact or version identifiers is a confirmed provenance `MISMATCH`.

Body comparison tolerates only harmless Blogger markup normalization. Changed, missing, or additional authored text fails verification. Missing or extra labels, a different target, a non-draft state, or a different source reference also fails verification.

The verification evidence must make each material check independently visible rather than reducing the result to a bare success flag.

### Verification Acceptance Criteria

- [ ] The Blogger draft visibly presents the expected authored text with its paragraph structure preserved.
- [ ] Equivalent Blogger-normalized markup can pass without requiring raw byte equality.
- [ ] Changed, missing, or additional authored text produces `MISMATCH`.
- [ ] Label order alone does not cause a mismatch; a missing or additional label does.
- [ ] A different target, non-draft state, or valid sidecar provenance reference produces `MISMATCH`.
- [ ] An automated mismatch demonstration proves that altered content or state cannot return `VERIFIED`.

## Durable Provenance

Source: `scope.md > The Core Loop`, `scope.md > Why This Matters to the Learner`.

The `artifact_id` and `version_id` association must survive independently of the original creation response. It is stored in one owner-controlled JSON sidecar outside the repository, keyed by the configured Blogger `blog_id + post_id`. A later inspect/verify call recovers that association independently using only the configured target, supplied post identity, and sidecar.

Blogger remains the projection truth for the post identity, state, title, body, and labels. The sidecar is only provenance truth. It grants no permission to publish or perform any Blogger mutation, and it contains no credentials, tokens, authorization data, article content, labels, or raw Blogger requests.

Provenance does not appear in the reader-facing article body, title, or labels.

### Provenance Acceptance Criteria

- [ ] Independent inspection can verify provenance without access to the original creation receipt.
- [ ] The visible Blogger title, body, and labels contain no provenance marker.
- [ ] A valid sidecar record containing a different `artifact_id` or `version_id` produces a provenance `MISMATCH` and prevents `VERIFIED`.
- [ ] Missing, unreadable, corrupt, unsupported, locked, or integrity-conflicted sidecar state produces an `UNKNOWN` provenance check and prevents `VERIFIED`.
- [ ] No behavior interprets provenance as publication authorization or permits the sidecar to override Blogger projection facts.

## Result States

### Create Outcomes

- **`VERIFIED`** — Blogger creation, read-back, and every verification check succeeded.
- **`VALIDATION_FAILED`** — input was rejected before any Blogger request; no remote operation was attempted.
- **`CREATE_FAILED`** — evidence establishes that draft creation did not succeed.
- **`CREATED_UNVERIFIED`** — a draft is known to exist or its post identity is known, but read-back or another inconclusive condition—including provenance persistence or lookup failure—prevented correctness from being established, and no material check is a confirmed mismatch.
- **`MISMATCH`** — at least one material check is a confirmed mismatch, including a valid provenance record for the same `blog_id + post_id` containing different artifact or version identifiers.
- **`REMOTE_EFFECT_UNKNOWN`** — the request ended without establishing whether Blogger created a draft, and no reliable post identity is available. The result explicitly reports `remote_effect: unknown` and `retry_safe: false`.

### Inspect Outcomes

- **`VERIFIED`** — every material property matches.
- **`MISMATCH`** — at least one material Blogger or provenance property is a confirmed mismatch.
- **`ABSENT`** — Blogger conclusively reports that the post does not exist.
- **`ACCESS_DENIED`** — Blogger refuses permission to read the post or target.
- **`REMOTE_UNKNOWN`** — the current Blogger state or required provenance state cannot be established and no material check is a confirmed mismatch.
- **`VALIDATION_FAILED`** — the inspect request is invalid and no Blogger request was attempted.

### Retry Boundary

The server never automatically retries creation. In particular, `REMOTE_EFFECT_UNKNOWN` is a fail-closed stop: the caller is warned that a blind retry is unsafe because the first request may already have created a draft. Idempotency, deduplication, and reconciliation are outside this proof of concept.

## Product Decisions

- Expose exactly two actions: create draft and read-only inspect/verify — this proves the useful loop without becoming a general Blogger administration surface.
- Make read-back verification part of creation — API acceptance alone does not establish what exists remotely.
- Return structured partial and uncertain outcomes — “created,” “verified,” “mismatched,” and “unknown” are materially different operational facts.
- Store durable, independently recoverable provenance in one owner-controlled JSON sidecar keyed by configured `blog_id + post_id` — a caller-held receipt cannot support later independent verification, and the approved live Blogger contour did not provide a reliable `customMetaData` round-trip contract.
- Keep provenance outside reader-facing content and separate from Blogger projection truth — it is operational origin evidence, not article content or publication authority.
- Accept plain authored text only — this preserves the core proof while excluding rich-content and sanitization complexity.
- Use narrow deterministic normalization — harmless Blogger representation changes may pass, but changed authored text or material metadata may not.
- Never automatically retry an uncertain creation — without idempotency, a retry could create a duplicate draft.

## What We're Building

Source: `scope.md > The POC Boundary`.

- One MCP server operating against one configured Blogger account and target blog.
- One create action for a supplied title, plain-text body, labels, and source reference.
- Automatic remote read-back and verification after creation.
- One independent, read-only inspect/verify action.
- Durable provenance recoverable from an owner-controlled sidecar during later independent inspection.
- Structured, machine-branchable evidence for success, mismatch, known failure, and uncertainty.
- A real Blogger-backed happy-path demonstration and automated mismatch coverage.
- An inspectable action surface from which public publication is absent.

## Deferred From the POC

Source: `scope.md > Later`.

- **Idempotency and deduplication** — needed to make uncertain create retries safe, but not needed to prove the draft-only authority boundary.
- **Reconciliation after an unknown remote effect** — valuable for production recovery, but deliberately deferred with a fail-closed stop for this proof.
- **Finding and updating an existing draft by source reference** — would change the create-once primitive into synchronization behavior.
- **Repeatable synchronization** — belongs to a later production workflow rather than the minimal projection proof.
- **Publication-gateway behavior** — may be considered later but is outside the structurally draft-only product.

## Non-Goals

Source: `scope.md > Explicitly Cut`.

- Public publishing or publication authorization.
- Scheduling, deletion, draft updating, or general Blogger administration.
- Content generation, editing, or editorial judgment.
- Arbitrary target-blog selection.
- Rich HTML authoring, images, or other media.
- Google Drive ingestion or integration with The Mind.
- Multiple users, accounts, or blogs.
- Automatic retry when a create result is uncertain.
- Treating Blogger as provenance authority or treating the provenance sidecar as content, Blogger projection, or publication authority.

## Resolved Technical Mechanisms

No unresolved product or provenance architecture decision blocks implementation. The approved technical specification defines:

- one owner-controlled JSON provenance sidecar outside the repository, keyed by configured `blog_id + post_id`;
- the deterministic plain-text-to-Blogger representation and narrow body comparison normalization; and
- the exact product-owned validation constraints for Blogger label values.
