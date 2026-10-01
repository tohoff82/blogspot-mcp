# Draft-Only Blogger MCP

A local stdio MCP server that projects caller-supplied plain text into one configured Blogger blog as a private draft, reads it back with ADMIN view, and returns structured verification evidence. Durable source provenance lives in a separate owner-controlled JSON sidecar.

The complete MCP authority surface is exactly:

- `create_draft` — one private-draft insert attempt, provenance persistence, ADMIN read-back, and six-check verification;
- `inspect_draft` — read-only Blogger and sidecar verification for one known post ID.

There is no publish, update, delete, schedule, target-selection, generic Blogger request, or provenance-repair tool.

## Requirements

- Node.js `>=24 <25` and npm;
- a Google Cloud project with Blogger API v3 enabled;
- a Google OAuth 2.0 **Desktop app** client;
- one Blogger blog ID fixed by the operator;
- an owner-controlled directory outside this repository. On POSIX systems, use mode `0700` for the directory and `0600` for existing credential files.

Verify Node before installing:

```bash
node --version
npm ci
npm run build
```

`package-lock.json` is committed; use `npm ci` rather than regenerating dependency resolution.

## Local configuration

Copy `.env.example` to an ignored `.env` or export the same four variables through the process environment:

```dotenv
BLOGGER_BLOG_ID=1234567890123456789
BLOGGER_OAUTH_CLIENT_FILE=/absolute/external/path/client_secret.json
BLOGGER_TOKEN_FILE=/absolute/external/path/blogger-token.json
BLOGGER_PROVENANCE_FILE=/absolute/external/path/blogger-provenance.json
```

All paths must be absolute and outside the repository. The OAuth client must already exist as an owner-only regular file. The token may be absent only before first-time authentication. The provenance file may be absent; it is created only after an authorized Blogger create returns a usable post ID. Never commit `.env`, OAuth client data, tokens, or provenance-store contents.

## First-time OAuth authorization

1. In Google Cloud, enable Blogger API v3 and create/download a Desktop OAuth client.
2. Place that client JSON at `BLOGGER_OAUTH_CLIENT_FILE` with owner-only permissions.
3. Configure all four variables and run:

```bash
npm run auth
```

The command starts a loopback listener on `127.0.0.1`, uses state and PKCE, writes the fresh authorization URL to `~/.config/blogspot-mcp/oauth-authorization-url.txt` with mode `0600`, and attempts to open a browser. It removes the URL file after a successful callback and atomically stores only bounded refresh metadata at `BLOGGER_TOKEN_FILE`. Authorization URLs, OAuth state, client secrets, and tokens must not be copied into logs or chat.

## Start the MCP server

```bash
npm run build
npm start
```

Startup validates configuration and credential readiness before connecting stdio. Startup failures go to stderr; stdout is reserved for MCP protocol traffic.

Example MCP-host configuration:

```json
{
  "mcpServers": {
    "blogspot": {
      "command": "/absolute/path/to/node-24/bin/node",
      "args": ["/absolute/path/to/blogspot-mcp/dist/index.js"],
      "env": {
        "BLOGGER_BLOG_ID": "1234567890123456789",
        "BLOGGER_OAUTH_CLIENT_FILE": "/absolute/external/path/client_secret.json",
        "BLOGGER_TOKEN_FILE": "/absolute/external/path/blogger-token.json",
        "BLOGGER_PROVENANCE_FILE": "/absolute/external/path/blogger-provenance.json"
      }
    }
  }
}
```

`tools/list` must return exactly `create_draft` and `inspect_draft`. The configured blog and draft state are not caller inputs.

## Tool inputs and evidence

`create_draft` accepts an already-authored projection:

```json
{
  "title": "Example title",
  "body": "First paragraph.\n\nSecond paragraph.",
  "labels": ["example", "draft-only"],
  "source": {
    "artifact_id": "artifact-example",
    "version_id": "version-example"
  }
}
```

`inspect_draft` accepts a known post ID plus the same expected projection:

```json
{
  "post_id": "9876543210987654321",
  "expected": {
    "title": "Example title",
    "body": "First paragraph.\n\nSecond paragraph.",
    "labels": ["example", "draft-only"],
    "source": {
      "artifact_id": "artifact-example",
      "version_id": "version-example"
    }
  }
}
```

A `VERIFIED` result contains six independent checks: configured target, `DRAFT` state, title, canonical body, exact label set, and provenance. Blogger evidence covers the remote projection. Sidecar evidence separately covers `artifact_id` and `version_id`; the sidecar cannot override Blogger facts or grant publication authority.

Create outcomes are `VERIFIED`, `VALIDATION_FAILED`, `CREATE_FAILED`, `CREATED_UNVERIFIED`, `MISMATCH`, and `REMOTE_EFFECT_UNKNOWN`. Inspect outcomes are `VERIFIED`, `VALIDATION_FAILED`, `MISMATCH`, `ABSENT`, `ACCESS_DENIED`, and `REMOTE_UNKNOWN`. These are normal schema-valid MCP results. `isError: true` is reserved for a sanitized unexpected internal defect.

`REMOTE_EFFECT_UNKNOWN` means a create request may have reached Blogger but no reliable result was established. It reports `retry_safe: false`; do not retry blindly. This POC has no deduplication or reconciliation operation.

## Provenance sidecar

The sidecar is a schema-versioned JSON file keyed by configured `blog_id + post_id`. Both the store and each record use `schema_version: 1`. Writes are non-overwriting, process-serialized, guarded by an adjacent exclusive lock, flushed to an owner-only temporary file, atomically renamed, and re-read before provenance can match.

The sidecar contains only blog/post identity and opaque artifact/version identifiers. It contains no OAuth material, authorization headers, article title/body/labels, raw Blogger request, or publication authority. Provenance never falls back to Blogger title, body, labels, `customMetaData`, or a caller-held receipt.

A live, indeterminate, or stale lock fails closed. There is no automatic stale-lock stealing. An operator may remove a stale lock only after establishing that no active writer owns it.

## Testing and live-effect boundary

Safe deterministic verification:

```bash
npm ci
npm run build
npm test
BLOGGER_LIVE_TEST=0 npm run test:live
```

The default suite excludes live tests and uses injected adapters; it does not contact Blogger. `BLOGGER_LIVE_TEST=0` runs only the live-fixture assertions and skips the Blogger create test.

The live test is intentionally opt-in:

```bash
BLOGGER_LIVE_TEST=1 npm run test:live
```

Do not run that command without separate, explicit authorization for exactly one Blogger draft create attempt. It has no automatic retry or cleanup. The completed Slice 2 evidence is recorded in `devpost/checklist.md`; documentation or demo verification does not authorize another live invocation.

## Operator and demo flow

1. Confirm Node 24, run `npm ci`, build, and run the deterministic tests.
2. Configure the four external values and complete `npm run auth` if needed.
3. Start the MCP server and show `tools/list`: only `create_draft` and `inspect_draft` appear.
4. Explain a previously established `VERIFIED` result: the Blogger projection evidence and sidecar provenance evidence are separate, and all six checks are `MATCH`.
5. Demonstrate `inspect_draft` with a deterministic known fixture, or with a future/live post only when its exact expected projection was independently retained before inspection. A fresh create requires a new external-effect authorization.
6. Show that no publish or general administration capability appears in the advertised surface.

The final clean Slice 2 gate produced post `1119814205973459388` with `VERIFIED` create and independent inspect results. It is accepted historical live evidence, but its exact generated visible title was not independently retained in repository evidence. Do not reconstruct expected projection values from the current remote Blogger post to claim independent verification; that would make the comparison circular. Preserve the governed evidence in `devpost/checklist.md` and do not fabricate missing expected inputs or provenance.

Documentation and demo-readiness verification require no new live Blogger invocation. Use a deterministic fixture for a replayable inspect demonstration, or retain the complete expected projection independently before inspecting a future separately authorized live post.

## Manual cleanup

This server intentionally cannot delete drafts. If a test draft should be removed, an authorized human must do so separately through Blogger’s own UI or another independently governed administrative workflow. Manual cleanup is not part of the MCP demo and must never be inferred from test completion.
