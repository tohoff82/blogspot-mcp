---
doc: scope
status: approved
---

# Draft-Only Blogger MCP

A small MCP server that projects finished, externally authored content into one configured Blogger blog as a private draft, then reads it back and verifies the remote result.

## The Unique Kernel

The draft-only authority boundary is structural: an agent can create and inspect a private Blogger draft, but the MCP server exposes no capability that can publish it publicly. This is a property of the tool surface, not a prompt instruction asking the agent to behave.

## Who It's For

A writer, operator, or upstream system that already has a finished authored artifact and wants an AI agent to place it into Blogger without granting the agent general publishing authority. The content is already authored upstream and explicitly supplied to this server as ready for draft projection. Blogger is a projection target, not the canonical manuscript or the authority that decides whether it may become public.

## The Core Loop

The caller supplies one explicit payload containing a title, body, labels, and a minimal source artifact/version reference. The server creates one private draft in the single configured and permitted Blogger blog, reads the remote post back, and returns structured evidence connecting that exact source version to the resulting post, content, labels, target, status, and verification outcome.

This is a create-once primitive. Re-submitting the same artifact/version does not locate, update, or synchronize an earlier draft.

## Inspiration & Identity

It should feel like a small, inspectable developer tool: explicit inputs, bounded authority, structured results, clear failure states, and evidence rather than a bare `success` response. Its spirit is closer to a focused Unix-style tool or well-designed CLI than to a general Blogger administration layer.

## Why This Matters to the Learner

The project makes the distinction between “content is ready” and “content may be made public” concrete in an MCP/API contract. It also creates a generic downstream boundary that The Mind could use someday without coupling this project to The Mind's code, storage, or runtime.

## What “Working” Looks Like

In a one-minute end-to-end demonstration:

1. An agent invokes the MCP capability with one authored payload and receives a structured result containing the source artifact/version reference, Blogger post identity, configured target, remote draft status, and verification outcome.
2. Blogger visibly contains the real remote post as a private draft with the expected title, body, and labels.
3. The exposed MCP tool surface visibly supports draft creation and inspection/verification but contains no public-publish capability.

An automated mismatch test also proves that a content or status mismatch cannot produce a successful verification result.

## The POC Boundary

- One Blogger account and one permitted target blog, fixed in server configuration rather than chosen by the caller.
- Generic, externally supplied text content that is already authored.
- Title, body, labels, and a minimal source artifact/version reference.
- One create operation through the official Blogger API, followed by remote read-back and verification.
- Inspectable evidence covering the source reference, remote post identity, configured target, title, body, labels, draft status, and verification result.
- A capability surface from which public publication is entirely absent.
- A real Blogger-backed happy-path demonstration plus automated verification-failure coverage.

## Later

- Deduplication and idempotent retries.
- Locating and updating an existing draft for the same source artifact/version.
- Repeatable synchronization and production publication-gateway behavior.

## Explicitly Cut

- **Public publishing:** excluded to prove the central authority boundary.
- **Scheduling and deletion:** unrelated to the create-and-verify primitive and would broaden remote authority.
- **Content generation or editorial judgment:** content arrives already authored; this server does not decide whether it is good or publishable.
- **Arbitrary target-blog selection:** the caller cannot redirect effects beyond the configured permitted blog.
- **Images or other media:** text is enough to prove the core loop.
- **Google Drive ingestion and The Mind integration:** inputs remain generic and externally supplied so the project has no upstream-system dependency.
- **Multiple users, accounts, or blogs:** one account and one configured blog are sufficient for the proof.
- **A general Blogger CRUD wrapper or publication-management system:** only the minimum draft creation and inspection/verification surface belongs in this project.
