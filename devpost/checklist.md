---
doc: checklist
status: draft
---

# Build Checklist

Build mode: pending learner choice after checklist approval

Git synchronization authority: After each mechanically verified slice, and after any mechanically verified final completion work that requires a commit, commit only that slice's intended changes with the specified message and push the resulting commit to the existing upstream/current branch on `origin`. Report the local commit SHA and successful remote sync. Do not force-push, rewrite history, reset destructively, create or delete branches, create tags or releases, create a PR, change repository visibility, or include unrelated pre-existing work. If the remote has diverged or a normal push is rejected, stop and report rather than resolving it destructively.

## Slices

- [ ] **1. The complete draft-only MCP contract works against deterministic doubles**
  Becomes usable: An MCP client can list exactly `create_draft` and `inspect_draft`, submit a valid authored projection, receive structured verification evidence, and observe validation or mismatch outcomes without contacting Blogger.
  Why now: This proves the unique kernel first: the caller-visible surface contains draft creation and read-only inspection but no publish capability. Bootstrapping, schemas, canonicalization, provenance, verification, handlers, and the first vertical contract test land together so later remote work is constrained by a working interface.
  PRD ref: `prd.md > The Core Journey` (steps 1-2 and 5-7); `prd.md > Interaction Surface`; `prd.md > Verification Semantics`; `prd.md > Durable Provenance`
  Spec ref: `spec.md > Components`; `spec.md > Tool Contracts`; `spec.md > Body Representation and Canonicalization`; `spec.md > Label Validation and Comparison`; `spec.md > Durable Provenance`; `spec.md > File Structure`
  Build: Scaffold the strict Node.js/TypeScript ESM project and locked dependencies; implement the input/output contracts, projection validator, body and provenance codecs, six-check verifier, result mapping, create and inspect orchestration, and the stdio MCP server with injectable deterministic adapter doubles. Add unit and MCP contract coverage for valid input, structured `VALIDATION_FAILED`, a verified create/read-back, independent verified inspection, material mismatch, equivalent Blogger serialization, exact label-set behavior, semantic provenance comparison, and an exact two-tool `tools/list` surface with no publish operation.
  Verify (mechanical): Run `npm ci`, `npm run build`, and `npm test`; confirm the deterministic suite passes, `tools/list` is exactly `create_draft` plus `inspect_draft`, valid fake-adapter create and inspect paths return schema-valid `VERIFIED`, malformed product fields return schema-valid `VALIDATION_FAILED` before any adapter call, and a changed body, status, target, label set, or provenance cannot return `VERIFIED`.
  Learner check: Inspect the two advertised MCP tools and one `VERIFIED` result beside one `MISMATCH` result; confirm the callable surface and structured evidence express the authority boundary you intended.
  Commit: `Build deterministic draft-only MCP kernel`

- [ ] **2. One guarded real Blogger draft passes the live evidence gate**
  Becomes usable: With owner-controlled external credentials, the local server can authenticate, create at most one private draft in the configured blog, read that exact post back, and independently inspect it as `VERIFIED`.
  Why now: The deprecated `customMetaData` field, Blogger's returned HTML, and the selected label boundary are the design's highest external uncertainties. The adapter and credential path are added only after the deterministic contract exists, and contract tests must prove the one-attempt boundary before the first real write.
  PRD ref: `prd.md > Create Draft Behavior`; `prd.md > Inspect and Verify Behavior`; `prd.md > Retry Boundary`; `prd.md > Durable Provenance`
  Spec ref: `spec.md > Configuration Loader and Startup Preflight`; `spec.md > OAuth Bootstrap Command`; `spec.md > OAuth Credential Provider`; `spec.md > Narrow Blogger REST Adapter`; `spec.md > External Services and Dependencies`; `spec.md > First Live Blogger Gate`; `spec.md > Important Failure Modes`
  Build: Implement phase-specific environment and external-file validation, Desktop OAuth loopback bootstrap with state and PKCE, atomic owner-only token storage, authorization-header acquisition, the hand-written Blogger adapter with only fixed-target `insertDraft` and `getPostAdmin`, fixed per-request deadlines, and opt-in live-gate coverage. Before any real create, add deterministic adapter tests for exact URLs, methods, query parameters, payload fields, response parsing, pre- versus post-insert failure classification, fresh abort signals, and zero-or-one insert calls under every exercised outcome. After all deterministic adapter, auth, and preflight verification passes, stop at the explicit external-effect checkpoint, report that the live gate is ready, and request one learner authorization for the already-specified single real private-draft creation. Only after that authorization, run the single-attempt live payload covering paragraph and line breaks, HTML-sensitive text, 20 unique labels totaling 200 code points, and versioned provenance.
  Verify (mechanical): Run `npm run build` and `npm test`; verify all adapter and auth safety contracts pass before live access. After the learner explicitly authorizes the ready live gate, use the configured external OAuth files and explicit live-test environment to run `BLOGGER_LIVE_TEST=1 npm run test:live` once; require a known post ID, configured test target, `DRAFT` state, six `MATCH` checks, logical `customMetaData` recovery, exact boundary labels, body round-trip, and a later independent `inspect_draft` result of `VERIFIED`. The authorization covers exactly one Blogger create attempt against the configured test blog with hard-coded `isDraft=true`, no retry, no fallback provenance mechanism, and no publish, update, delete, or schedule operation. Stop if the create effect is unknown or `customMetaData` does not round-trip.
  Learner check: Open the reported post in Blogger, confirm it is a private draft with the expected visible title, body, and labels, then compare it with the create and independent inspect evidence. Report anything that differs or feels ambiguous.
  Commit: `Add guarded Blogger integration and live gate`

- [ ] **3. The local tool is reproducible and fail-closed for operators**
  Becomes usable: Another operator can configure, authenticate, start, exercise, and understand the local stdio server while every specified validation, credential, startup, transport, timeout, mismatch, and uncertainty path remains machine-branchable and non-secret.
  Why now: Once the real compatibility gate passes, the remaining work can harden and document the proven path without hiding an external design failure. This final slice turns the live proof into a reproducible POC and completes the demo evidence rather than broadening the feature set.
  PRD ref: `prd.md > Output Character`; `prd.md > Result States`; `prd.md > What We're Building`; `prd.md > Non-Goals`
  Spec ref: `spec.md > Where It Runs and How Someone Tries It`; `spec.md > MCP Server and Contract Surface`; `spec.md > MCP isError Policy`; `spec.md > Verification Plan`; `spec.md > Demo Acceptance`; `spec.md > What Was Simplified and Why`
  Build: Complete the deterministic default suite for all create and inspect outcomes and field invariants, startup-before-stdio failure, stdout discipline, credential-shaped redaction, token-target race revalidation, and sanitized unexpected-defect handling. Finalize `package.json`, lockfile, strict compiler configuration, live-test exclusion, `.env.example`, credential ignores, startup/auth scripts, and a concise README covering external credential placement, authentication, MCP host configuration, safe live testing, manual Blogger cleanup, demo flow, and the structurally absent publish authority.
  Verify (mechanical): From the committed manifest run `npm ci`, `npm run build`, and `npm test`; confirm no default test performs live network access, all declared domain outcomes validate as normal MCP results, unexpected defects use only the sanitized error path, stdout remains protocol-only, invalid configuration fails before stdio, and the exact advertised tool list remains unchanged. Follow the README setup and MCP-host commands against the already-proven configuration and confirm the demo sequence can be reproduced without another automatic create or any exposed publish, update, delete, schedule, target-selection, or generic Blogger operation.
  Learner check: Follow the README as the demo operator: start the server, inspect the two-tool surface, exercise the core journey using the known live-gate draft where possible, and identify any instruction, result, or failure state that would make the one-minute demonstration confusing.
  Commit: `Harden and document the Blogger MCP POC`

## Hands-on Checkpoints

- [ ] Slice 2 external-effect authorization — after deterministic adapter/auth/preflight verification passes and before the first real Blogger `POST`, learner explicitly authorizes the one-attempt private-draft live gate
- [ ] Early usable behavior explored — after slice 2 live Blogger gate, before final hardening
- [ ] Final kick-the-tires exploration and feedback completed

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: [what actually happened; real document/test/code references; unfinished work if interrupted]
Route and stops: [actual paths and symbols; guided stops completed, or reference-only route]
Edit outcome: [tried/kept/reverted/declined/not applicable; verification if changed]
Reflection: [offered/answered/declined/already covered — personal answer belongs only in the ignored profile]
Activity mode: [live app and editor, explicit static fallback, focused alternative, prior practice, or recap]

## Revisions
