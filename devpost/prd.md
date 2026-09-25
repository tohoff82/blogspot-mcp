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
3. The server creates one private draft in the single configured Blogger target. The caller cannot select another blog or request another publication state.
4. After Blogger reports creation, the server reads the new post back from Blogger before returning.
5. The server verifies the configured target, private-draft state, title, normalized body, exact label set, and durable source reference against the expected projection.
6. Only a complete match returns `VERIFIED`. Every other result identifies whether creation failed, a draft exists but is unverified or mismatched, or the remote effect itself is unknown.
7. At any later point, the caller can invoke the read-only inspect/verify action with a post identity and the expected projection data. The server reads the current post, recovers its durable provenance, performs the same material checks, and reports the current remote truth.

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

It retrieves the post only from the configured Blogger target. It then reports the current remote state and whether that state corresponds to the supplied expectations. The action is read-only and does not repair, update, recreate, publish, or otherwise mutate the post.

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

Body comparison tolerates only harmless Blogger markup normalization. Changed, missing, or additional authored text fails verification. Missing or extra labels, a different target, a non-draft state, or a different source reference also fails verification.

The verification evidence must make each material check independently visible rather than reducing the result to a bare success flag.

### Verification Acceptance Criteria

- [ ] The Blogger draft visibly presents the expected authored text with its paragraph structure preserved.
- [ ] Equivalent Blogger-normalized markup can pass without requiring raw byte equality.
- [ ] Changed, missing, or additional authored text produces `MISMATCH`.
- [ ] Label order alone does not cause a mismatch; a missing or additional label does.
- [ ] A different target, non-draft state, or provenance reference produces `MISMATCH`.
- [ ] An automated mismatch demonstration proves that altered content or state cannot return `VERIFIED`.

## Durable Provenance

Source: `scope.md > The Core Loop`, `scope.md > Why This Matters to the Learner`.

The `artifact_id` and `version_id` association must survive independently of the original creation response. A later inspect/verify call must be able to recover that association from the remote post or metadata stored with that post and compare it with the caller's expected reference.

Provenance must not appear as part of the reader-facing article content. It records origin only and conveys no permission to publish.

### Provenance Acceptance Criteria

- [ ] Independent inspection can verify provenance without access to the original creation receipt.
- [ ] The visible article body contains only the authored publication content.
- [ ] A mismatched `artifact_id` or `version_id` prevents `VERIFIED`.
- [ ] No behavior interprets provenance as publication authorization.

## Result States

### Create Outcomes

- **`VERIFIED`** — Blogger creation, read-back, and every verification check succeeded.
- **`VALIDATION_FAILED`** — input was rejected before any Blogger request; no remote operation was attempted.
- **`CREATE_FAILED`** — evidence establishes that draft creation did not succeed.
- **`CREATED_UNVERIFIED`** — a draft is known to exist or its post identity is known, but read-back or another inconclusive condition prevented correctness from being established.
- **`MISMATCH`** — the created draft was read successfully and materially differs from the expected projection.
- **`REMOTE_EFFECT_UNKNOWN`** — the request ended without establishing whether Blogger created a draft, and no reliable post identity is available. The result explicitly reports `remote_effect: unknown` and `retry_safe: false`.

### Inspect Outcomes

- **`VERIFIED`** — every material property matches.
- **`MISMATCH`** — the post was read and at least one material property differs.
- **`ABSENT`** — Blogger conclusively reports that the post does not exist.
- **`ACCESS_DENIED`** — Blogger refuses permission to read the post or target.
- **`REMOTE_UNKNOWN`** — the current remote state cannot be established.
- **`VALIDATION_FAILED`** — the inspect request is invalid and no Blogger request was attempted.

### Retry Boundary

The server never automatically retries creation. In particular, `REMOTE_EFFECT_UNKNOWN` is a fail-closed stop: the caller is warned that a blind retry is unsafe because the first request may already have created a draft. Idempotency, deduplication, and reconciliation are outside this proof of concept.

## Product Decisions

- Expose exactly two actions: create draft and read-only inspect/verify — this proves the useful loop without becoming a general Blogger administration surface.
- Make read-back verification part of creation — API acceptance alone does not establish what exists remotely.
- Return structured partial and uncertain outcomes — “created,” “verified,” “mismatched,” and “unknown” are materially different operational facts.
- Store durable, independently recoverable provenance with the remote post — a caller-held receipt cannot support later independent verification.
- Keep provenance outside reader-facing content — it is operational metadata, not part of the article.
- Accept plain authored text only — this preserves the core proof while excluding rich-content and sanitization complexity.
- Use narrow deterministic normalization — harmless Blogger representation changes may pass, but changed authored text or material metadata may not.
- Never automatically retry an uncertain creation — without idempotency, a retry could create a duplicate draft.

## What We're Building

Source: `scope.md > The POC Boundary`.

- One MCP server operating against one configured Blogger account and target blog.
- One create action for a supplied title, plain-text body, labels, and source reference.
- Automatic remote read-back and verification after creation.
- One independent, read-only inspect/verify action.
- Durable provenance recoverable during later remote inspection.
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
- Treating Blogger as the canonical manuscript or provenance authority.

## Open Questions for the Technical Spec

No unresolved product decision blocks `4-spec`. The technical specification must choose and document these mechanisms before implementation:

- how durable provenance is stored with a Blogger post without entering reader-facing article content;
- the deterministic plain-text-to-Blogger representation and the narrow normalization used for body comparison; and
- the exact validation constraints for Blogger label values.
