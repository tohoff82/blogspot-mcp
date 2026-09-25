---
doc: spec
status: draft
---

# Draft-Only Blogger MCP — Technical Spec

## How This Works, In Plain Language

This project is a local TypeScript program that an MCP host starts over stdio. It exposes exactly two tools: `create_draft` and `inspect_draft`. The caller supplies finished text and source identifiers, but never supplies a blog ID, publication state, Google credential, URL, HTTP method, or generic Blogger operation.

At startup, the server reads one configured Blogger blog ID and two paths to credential files from environment variables. It validates that configuration and establishes that the OAuth credential can provide an access token before connecting the MCP server. Secrets remain in owner-only files outside the repository and never enter MCP requests or results.

For creation, the server validates the complete projection, converts the plain-text body into one deterministic HTML representation, stores the source reference in Blogger's post `customMetaData`, and makes at most one request to create a private draft. It then retrieves that exact post from the configured blog with admin detail and compares every material fact. Only a complete match is `VERIFIED`. An uncertain create is a fail-closed stop and is never retried automatically.

For later inspection, the server retrieves one caller-identified post from the same configured blog and runs the same checks without changing anything. The Blogger adapter is deliberately limited to one insert route and one get route. Public publishing is absent from the MCP surface and from the adapter.

This shape proves the authority boundary in `scope.md > The Unique Kernel` without adding a web server, hosting, a database, synchronization, or general Blogger administration.

## The Core Journey Through the System

Implements `prd.md > The Core Journey`.

1. An MCP host starts the local process. Configuration and OAuth readiness are checked before the two tools become usable.
2. The caller invokes `create_draft` with a title, plain-text body, optional labels, and `{artifact_id, version_id}`.
3. The tool schema and domain validator reject the entire request before Blogger is contacted if any input is invalid.
4. The body codec escapes authored characters and converts the accepted plain text to deterministic `<p>` and `<br>` markup. The provenance codec serializes `{schema_version, artifact_id, version_id}` into `customMetaData`.
5. The narrow adapter issues exactly one `POST` to the configured blog with `isDraft=true`. No automatic create retry exists.
6. If Blogger returns a post identity, the adapter issues a `GET` for that identity from the same configured blog with `view=ADMIN`.
7. The verifier compares target, draft status, title, reconstructed canonical body, exact label set, and parsed provenance fields.
8. The MCP tool returns one structured outcome and a concise JSON text projection of that same outcome.
9. Later, `inspect_draft` accepts the post ID and expected projection, performs only the admin `GET`, and reports the current remote truth using the same verifier.

```text
MCP host
   │ stdio: create_draft / inspect_draft
   ▼
MCP schemas and tool handlers
   │ validated domain request
   ▼
Projection codecs + verification engine
   │ only explicit insert/get commands
   ▼
Narrow Blogger adapter ── OAuth headers from local credential provider
   │
   ├── POST configured blog /posts?isDraft=true   (create only)
   └── GET  configured blog /posts/{postId}?view=ADMIN (read only)
```

## Stack

Versions below record the selected major/minor line. `package-lock.json` is committed and is the reproducible authority for the exact resolved graph.

- **Node.js 24 LTS** — local runtime; supplies ESM, native `fetch`, crypto, HTTP loopback support, and `.env` loading without another runtime framework. [Node 24 documentation](https://nodejs.org/docs/latest-v24.x/api/)
- **TypeScript 7.x**, strict ESM — compile-time contracts and explicit discriminated results. [TypeScript documentation](https://www.typescriptlang.org/docs/)
- **`@modelcontextprotocol/server` 2.1.x** — MCP tool registration and stdio serving. Only the server package is a runtime dependency. [MCP TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/)
- **`@modelcontextprotocol/client` 2.1.x** — development-only dependency for the deterministic in-memory/stdio MCP contract test. It adds no server capability. [MCP TypeScript SDK v2 API](https://ts.sdk.modelcontextprotocol.io/v2/api/)
- **Zod 4.x** — environment, tool input/output, OAuth file, provenance, and Blogger response validation. [Zod documentation](https://zod.dev/)
- **`google-auth-library` 11.x** — Desktop OAuth client, PKCE helpers, access-token refresh, and authorization-header acquisition. It does not make Blogger requests on behalf of the domain layer. [Google Auth Library for Node.js](https://github.com/googleapis/google-auth-library-nodejs)
- **`parse5` 8.x** — standards-based HTML fragment parsing for the narrow read-back canonicalization algorithm. [parse5 documentation](https://parse5.js.org/)
- **Vitest 5.x** — unit, adapter-contract, MCP-surface, and opt-in live tests. [Vitest documentation](https://vitest.dev/)
- **Native Node `fetch`** — sends the two explicitly constructed Blogger requests. The adapter obtains headers from the OAuth client and does not expose a generic authenticated-request function upward. [Node `fetch` documentation](https://nodejs.org/docs/latest-v24.x/api/globals.html#fetch)

The version snapshot was checked on 2026-09-25. Dependency installation during the build must commit both `package.json` and `package-lock.json`; later builds use `npm ci`.

## Where It Runs and How Someone Tries It

Implements `prd.md > Interaction Surface` and `prd.md > What We're Building`.

### Runtime

- Local Node.js 24 process on the learner's computer.
- MCP transport: stdio only.
- External network dependency: Google OAuth endpoints and Blogger API v3.
- No hosted service, Streamable HTTP endpoint, database, background worker, or remote secret store.
- Submission still requires a short demo video and a public GitHub repository. Deployment is intentionally absent and does not replace either requirement.

### Environment

Exactly three environment variables configure the POC:

```dotenv
BLOGGER_BLOG_ID=1234567890123456789
BLOGGER_OAUTH_CLIENT_FILE=/absolute/path/outside/repository/client_secret.json
BLOGGER_TOKEN_FILE=/absolute/path/outside/repository/blogger-token.json
```

- `BLOGGER_BLOG_ID` is a non-empty decimal Blogger blog identifier and is never accepted from an MCP caller.
- Both file paths must be absolute, resolve outside the repository, identify regular files where a file must already exist, and have no group/other permission bits on POSIX systems.
- `.env.example` contains names and placeholder path shapes only. `.env`, client files, token files, and common credential filename patterns are ignored by Git.
- Environment variables are the only configuration authority. A local `.env` is merely one way Node populates `process.env`; there is no second config-file schema or precedence system.

### First-Time Authentication

1. Create a Google Desktop OAuth client, enable Blogger API v3, and place the downloaded client file outside the repository with owner-only permissions.
2. Set the three environment variables, directly or in an ignored local `.env`.
3. Run `npm ci`, then `npm run auth`.
4. The auth command binds an HTTP listener to `127.0.0.1` on an available port, generates random `state`, generates a PKCE verifier/challenge using `S256`, requests `access_type=offline` with the Blogger scope, and opens the system browser.
5. The loopback callback must contain the expected state and an authorization code. State comparison is timing-safe. The command exchanges the code locally using the retained PKCE verifier.
6. The command requires a refresh token, writes the credential material atomically to `BLOGGER_TOKEN_FILE` with mode `0600`, and emits only a bounded success message containing no token or secret value.
7. The loopback server closes on success, rejection, timeout, or error. OAuth codes, tokens, client secrets, and full callback URLs are never logged.

Google continues to support loopback IP redirects for Desktop OAuth clients. [Google loopback flow guidance](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration) and [OAuth for installed apps](https://developers.google.com/identity/protocols/oauth2/native-app).

### Startup

Run:

```bash
npm ci
npm run build
npm start
```

`npm start` loads an ignored `.env` if present and starts `dist/index.js`; exported environment variables also work. Before stdio is connected, startup:

1. validates all three environment values;
2. validates both external JSON file shapes and safe file permissions;
3. loads the refresh credential into an OAuth client restricted to `https://www.googleapis.com/auth/blogger`;
4. obtains or refreshes an access token; and
5. only then registers and serves the MCP tools.

Failure produces a concise diagnostic on stderr and a non-zero exit. stdout is reserved for MCP protocol traffic. No secret value or token response is included in diagnostics.

### MCP Host and Demo Recording

Configure a local MCP host with:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/blogspot-mcp/dist/index.js"],
  "env": {
    "BLOGGER_BLOG_ID": "configured outside the caller prompt",
    "BLOGGER_OAUTH_CLIENT_FILE": "/absolute/external/path/client_secret.json",
    "BLOGGER_TOKEN_FILE": "/absolute/external/path/blogger-token.json"
  }
}
```

The one-minute recording shows:

1. `tools/list` contains exactly `create_draft` and `inspect_draft`;
2. `create_draft` receives one safe demonstration payload and returns a post ID plus `VERIFIED` evidence;
3. Blogger shows that exact post as a private draft with the expected visible title, body, and labels; and
4. `inspect_draft` independently retrieves the post by ID and returns `VERIFIED` for the expected projection.

The live test draft and the recorded-demo draft may be separate because each demonstrates a separate explicit invocation. Neither is automatically deleted; their post IDs are reported for later human-controlled cleanup through Blogger.

## Look and Feel

Implements `prd.md > Output Character` and carries forward `scope.md > Inspiration & Identity`.

There is no visual application UI. The interface should feel like a focused Unix-style developer tool:

- concise snake-case field names and stable uppercase outcome values;
- structured evidence before prose;
- explicit requested, configured, observed, mismatched, and unknown facts;
- one short human-readable `message`, never used as the machine control signal;
- no decorative chatter, progress animation, credential output, or bare `success: true` response.

## Components

### Configuration Loader and Startup Preflight

Implements `prd.md > Input Contract` and `prd.md > Interaction Surface`.

Reads only the three named environment variables, rejects missing/relative/unsafe paths, validates file shapes and permissions, constructs the OAuth credential provider and narrow adapter, and refuses to connect stdio until authentication readiness succeeds. It never accepts caller overrides.

### OAuth Bootstrap Command

Implements the accepted local authentication boundary supporting `prd.md > Interaction Surface`.

Runs only through `npm run auth`. It performs Desktop OAuth with loopback `127.0.0.1`, an ephemeral port, random state, PKCE S256, offline access, and the Blogger scope. It atomically stores credential material outside the repository with owner-only permissions. It is not imported into the MCP tool registry.

### OAuth Credential Provider

Supports the Blogger adapter without expanding MCP authority.

Loads the external OAuth client and refresh-token files, refreshes access as needed, and returns authorization headers only to the adapter. It exposes neither token values nor a generic HTTP request function to handlers or callers.

### MCP Server and Contract Surface

Implements `prd.md > Interaction Surface`.

Registers exactly two tools, with explicit Zod input and output schemas:

- `create_draft`
- `inspect_draft`

It registers no resources or prompts. Each handler returns `structuredContent` validated against its output schema and one `TextContent` item containing `JSON.stringify(structuredContent)`. The text is a compatibility projection of the same object, not an independently composed result.

### `create_draft` Tool Handler

Implements `prd.md > Create Draft Behavior`, `prd.md > Retry Boundary`, and `prd.md > Create Outcomes`.

Accepts only the authored projection. It validates and normalizes locally, requests one adapter insert, performs read-back when a post ID is available, delegates comparison to the shared verifier, and maps evidence to the create result union. It contains no retry loop and never calls insert more than once per invocation.

### `inspect_draft` Tool Handler

Implements `prd.md > Inspect and Verify Behavior` and `prd.md > Inspect Outcomes`.

Accepts a Blogger post ID plus the expected authored projection. It performs one read-only adapter get from the configured blog and maps the result through the shared verifier. It cannot update, repair, recreate, publish, or delete.

### Projection Validator

Implements `prd.md > Input Contract`.

Validates title, body, labels, source identifiers, and post ID before an adapter call. It derives the expected normalized label set, canonical body, HTML body, and provenance object. Validation issues use stable field paths and codes.

### Plain-Text Body Codec

Implements `prd.md > Verification Semantics`.

Owns both the forward plain-text-to-HTML algorithm and the reverse Blogger-HTML-to-canonical-text algorithm defined under **Body Representation and Canonicalization**. It performs no generic rendered-text or browser-layout comparison.

### Provenance Codec

Implements `prd.md > Durable Provenance`.

Serializes and parses the versioned JSON stored in `customMetaData`. Verification compares parsed fields rather than JSON bytes or property order. No receipt-only or local-only provenance store exists.

### Verification Engine

Implements `prd.md > Verification Semantics`.

Pure domain code that compares expected and observed target, status, title, body, labels, and provenance. It emits one independently visible check per property and returns `VERIFIED` only when every check is `MATCH`. A missing/unparseable fact is `UNKNOWN`, not a mismatch invented from absent evidence.

### Narrow Blogger REST Adapter

Implements `prd.md > Create Draft Behavior` and `prd.md > Inspect and Verify Behavior`.

Constructs only the two approved Blogger URLs from the fixed base URL, configured blog ID, and validated post ID. It obtains authorization headers internally, sends native `fetch` requests, validates remote JSON with Zod, and classifies HTTP/transport failures. It exposes typed `insertDraft` and `getPostAdmin` methods—not arbitrary URLs, methods, blog IDs, query parameters, or generic authenticated fetch.

### Result Mapper

Implements `prd.md > Result States` and `prd.md > Output Character`.

Builds the discriminated output unions from verified domain evidence. It keeps requested facts, observed facts, confirmed mismatches, and unknown facts separate. It also sets `remote_effect` and `retry_safe` explicitly for create outcomes.

## Tool Contracts

### Shared Authored Projection

Implements `prd.md > Input Contract`.

```ts
type AuthoredProjection = {
  title: string;
  body: string;
  labels?: string[];
  source: {
    artifact_id: string;
    version_id: string;
  };
};
```

- `title`, `body`, `artifact_id`, and `version_id` must be strings containing at least one non-whitespace character.
- Identifiers are opaque and are not ordered, resolved, or interpreted as authority.
- The configured blog ID and draft state do not appear in this type.

### `create_draft` Input

```ts
type CreateDraftInput = AuthoredProjection;
```

### `inspect_draft` Input

```ts
type InspectDraftInput = {
  post_id: string;
  expected: AuthoredProjection;
};
```

`post_id` is a required non-empty decimal Blogger post identifier. It is inserted only into the fixed post-ID path segment after validation.

### Structured Evidence

```ts
type CheckName =
  | "target"
  | "status"
  | "title"
  | "body"
  | "labels"
  | "provenance";

type VerificationCheck = {
  name: CheckName;
  result: "MATCH" | "MISMATCH" | "UNKNOWN";
  expected: unknown;
  observed?: unknown;
  detail?: string;
};

type RemotePostEvidence = {
  post_id: string;
  blog_id?: string;
  status?: string;
  title?: string;
  canonical_body?: string;
  labels?: string[];
  provenance?: {
    schema_version: 1;
    artifact_id: string;
    version_id: string;
  };
};
```

Unknown or sensitive response fields are not copied through. Raw OAuth responses, headers, tokens, client metadata, and entire raw Blogger payloads never appear in results.

### Create Output

Implements `prd.md > Create Outcomes` and `prd.md > Retry Boundary`.

```ts
type CreateOutcome =
  | "VERIFIED"
  | "VALIDATION_FAILED"
  | "CREATE_FAILED"
  | "CREATED_UNVERIFIED"
  | "MISMATCH"
  | "REMOTE_EFFECT_UNKNOWN";

type CreateDraftResult = {
  action: "create_draft";
  outcome: CreateOutcome;
  message: string;
  target: { blog_id: string };
  requested: AuthoredProjection;
  remote_effect: "none" | "created" | "unknown";
  retry_safe: boolean;
  remote?: RemotePostEvidence;
  checks?: VerificationCheck[];
  error?: {
    code: string;
    phase: "validation" | "auth" | "create" | "read_back" | "verification";
    detail: string;
  };
};
```

Outcome invariants:

- `VALIDATION_FAILED`: no Blogger call; `remote_effect: "none"`; `retry_safe: true` after correcting input.
- `CREATE_FAILED`: evidence establishes rejection before creation, such as an authenticated Blogger `400`, `401`, `403`, or other explicit non-retryable client response; `remote_effect: "none"`.
- `REMOTE_EFFECT_UNKNOWN`: timeout, connection loss, `408`, `429`, `5xx`, or another condition where no reliable Blogger success response or post identity was received even though the request may have reached Blogger; `remote_effect: "unknown"`; `retry_safe: false`.
- `CREATED_UNVERIFIED`: a Blogger `2xx` insert response or post identity establishes a draft effect, but the response cannot provide an ID for read-back, read-back fails, or another required fact is inconclusive; `remote_effect: "created"`; `retry_safe: false`.
- `MISMATCH`: read-back succeeded and at least one material check is `MISMATCH`; `remote_effect: "created"`; `retry_safe: false`.
- `VERIFIED`: all six checks are `MATCH`; `remote_effect: "created"`; `retry_safe: false`.

No outcome after an insert attempt causes another insert.

### Inspect Output

Implements `prd.md > Inspect Outcomes`.

```ts
type InspectOutcome =
  | "VERIFIED"
  | "MISMATCH"
  | "ABSENT"
  | "ACCESS_DENIED"
  | "REMOTE_UNKNOWN"
  | "VALIDATION_FAILED";

type InspectDraftResult = {
  action: "inspect_draft";
  outcome: InspectOutcome;
  message: string;
  target: { blog_id: string; post_id: string };
  expected: AuthoredProjection;
  remote?: RemotePostEvidence;
  checks?: VerificationCheck[];
  error?: {
    code: string;
    phase: "validation" | "auth" | "read" | "verification";
    detail: string;
  };
};
```

- Blogger `404` maps to `ABSENT`.
- Blogger `401` or `403` maps to `ACCESS_DENIED`.
- Transport failure, timeout, `408`, `429`, `5xx`, or an unparseable response maps to `REMOTE_UNKNOWN`.
- A readable post with any `MISMATCH` check maps to `MISMATCH`.
- A readable post with an `UNKNOWN` required check but no confirmed mismatch maps to `REMOTE_UNKNOWN`.
- Only six `MATCH` checks map to `VERIFIED`.

## Body Representation and Canonicalization

Implements `prd.md > Verification Semantics` and makes the accepted deterministic algorithm explicit.

### Forward Algorithm: Plain Text to Blogger HTML

1. Require a string containing at least one non-whitespace Unicode character.
2. Normalize line endings only: replace every CRLF and remaining CR with LF. Preserve all other code points, spaces, and line structure.
3. Split the normalized string on each exact two-LF sequence (`"\n\n"`). This preserves additional blank lines as empty or newline-containing paragraph segments rather than silently collapsing them.
4. For each paragraph segment, split on each remaining single LF.
5. Escape text-node-sensitive characters in every line: `&`, `<`, and `>` become HTML entities. Quotes are also escaped for one stable representation even though the text is not placed in attributes.
6. Join lines inside a paragraph with `<br>` and wrap the result in `<p>...</p>`.
7. Join paragraph elements with one formatting LF. That separator is serializer whitespace, not authored text.
8. Send this HTML as the Blogger `content` field. Do not insert provenance, labels, or hidden authority markers into it.

Example:

```text
Input:  First & second\ncontinued\n\nNext <paragraph>
HTML:   <p>First &amp; second<br>continued</p>\n<p>Next &lt;paragraph&gt;</p>
```

### Reverse Algorithm: Blogger HTML to Canonical Plain Text

1. Parse the returned `content` as an HTML fragment with `parse5`.
2. Ignore only whitespace-only top-level text nodes between paragraph elements; these can result from the serializer LF added above.
3. Accept top-level `<p>` elements. Inside them, accept text nodes and `<br>` elements only. HTML tag-name case, entity spelling, optional end-tag syntax, and `<br>`, `<br/>`, or `<br />` differences are parser-level equivalents.
4. Reject or mark the body check `UNKNOWN` for an unparseable fragment or unexpected structural element. Do not silently flatten arbitrary HTML.
5. Decode entities through the parser. Preserve text-node characters exactly.
6. Convert `<br>` to LF inside each paragraph.
7. Join successive paragraphs with exactly two LFs.
8. Compare that reconstructed value byte-for-byte as a Unicode string with the expected value after line-ending normalization from forward step 2. Do not trim, collapse whitespace, use browser-rendered text, or apply a general semantic similarity comparison.

Equivalent Blogger serialization can therefore pass while changed, missing, or additional authored text cannot. The first live gate proves that Blogger's actual representation round-trips the selected boundary sample. If Blogger introduces unsupported structure, verification does not claim a match.

## Label Validation and Comparison

Implements `prd.md > Input Contract` and `prd.md > Verification Semantics`.

1. Omitted labels become an empty set.
2. Every supplied item must be a string containing at least one character.
3. Reject a label if `label.trim() !== label`, if it contains U+002C comma, or if it contains any Unicode control character (`General_Category=Cc`).
4. Remove duplicates by exact, case-sensitive Unicode string equality, preserving the first occurrence for the outbound array. No caller text is rewritten.
5. Reject if the normalized unique set contains more than 20 labels.
6. Count Unicode code points across the normalized unique labels and reject if the total exceeds 200.
7. Compare read-back labels as exact case-sensitive sets; order does not matter, but any missing or additional label is a mismatch.

The values 20 and 200 are conservative, product-owned POC validation bounds. Blogger's published Posts schema specifies an array of strings but does not establish these as service maxima. The live gate proves only that one payload at the selected product boundary works for this POC; it does not claim to discover or prove Blogger's actual maximum limits. [Blogger Posts resource](https://developers.google.com/blogger/docs/3.0/reference/posts)

## Durable Provenance

Implements `prd.md > Durable Provenance`.

The post request supplies `customMetaData` as a JSON string with this logical value:

```json
{
  "schema_version": 1,
  "artifact_id": "opaque caller value",
  "version_id": "opaque caller value"
}
```

- Serialization uses a stable field order for inspectability, but correctness never depends on byte-identical JSON or property ordering.
- Read-back parses JSON, validates exactly the three supported fields with `schema_version: 1`, and compares `artifact_id` and `version_id` as exact strings.
- Unknown schema versions, malformed JSON, missing fields, and changed fields cannot produce `VERIFIED`.
- Provenance does not appear in the title, body, or labels and is never interpreted as publication permission.

`customMetaData` is present in the current Blogger v3 discovery schema but marked deprecated and is absent from the main Posts reference. It is therefore a gated mechanism, not an assumed stable contract.

The first live build gate must:

1. create one real private draft with versioned provenance;
2. retrieve that exact post again using `view=ADMIN`;
3. recover and parse `customMetaData`; and
4. prove the three fields survived unchanged at the logical-value level.

If this fails, stop the live build path and reopen this specification. There is no silent fallback to labels, visible or hidden body content, a local database, or a caller-held receipt.

## Data Model

No application database is used.

| Data | Origin | Where it lives | Update and return behavior |
|---|---|---|---|
| Configured blog ID | `BLOGGER_BLOG_ID` | Process environment | Immutable for one process. The caller cannot override it. |
| OAuth client material | Google Desktop client JSON | Owner-only file outside repository | Read during auth/runtime initialization; never returned. |
| Refresh/access credentials | OAuth bootstrap/token refresh | Owner-only token file outside repository; access token also in process memory | Token file written atomically by auth bootstrap; library refreshes access in memory. Never returned. |
| Authored projection | MCP caller | One tool invocation in memory | Validated before remote access; included as non-secret requested evidence in result. |
| Canonical body and labels | Projection validator/codecs | One invocation in memory | Deterministically derived; recomputed on later inspection from caller expectations. |
| Durable source reference | MCP caller | Blogger post `customMetaData` | Written once during insert; recovered from Blogger on every verification. No local source registry. |
| Remote draft | Blogger | Configured Blogger blog | Created once; never updated, published, scheduled, or deleted by this server. |
| Verification evidence | Expected projection + Blogger read-back | One invocation result | Rebuilt on every create read-back or inspect call; not persisted locally. |

When the process exits, only external OAuth files and the Blogger draft remain. A later `inspect_draft` does not need the original create receipt because it receives expectations and recovers provenance from the post.

## File Structure

```text
blogspot-mcp/
├── src/
│   ├── index.ts                    # startup preflight, composition, stderr-only failures
│   ├── server.ts                   # registers exactly two MCP tools and serves stdio
│   ├── config.ts                   # environment and external-path validation
│   ├── auth/
│   │   ├── bootstrap.ts            # separate Desktop OAuth loopback command
│   │   ├── oauth-client.ts         # loads OAuth client/token and provides headers
│   │   ├── token-store.ts          # atomic owner-only credential persistence
│   │   └── open-browser.ts         # system-browser launch without a shell or extra service
│   ├── blogger/
│   │   ├── adapter.ts              # only insertDraft and getPostAdmin
│   │   ├── response-schema.ts      # narrow Zod schema for consumed Blogger fields
│   │   └── errors.ts               # HTTP, transport, timeout, and parse classification
│   ├── domain/
│   │   ├── contracts.ts            # input/output/result discriminated unions
│   │   ├── projection.ts           # title/source/label validation and normalization
│   │   ├── body-codec.ts           # exact forward/reverse body algorithms
│   │   ├── provenance.ts           # schema-versioned customMetaData codec
│   │   ├── verify.ts               # six independent material checks
│   │   └── outcomes.ts             # evidence-to-outcome mapping and invariants
│   └── tools/
│       ├── create-draft.ts          # one-attempt create and read-back orchestration
│       └── inspect-draft.ts         # read-only inspection orchestration
├── test/
│   ├── unit/
│   │   ├── projection.test.ts       # validation and label guardrails
│   │   ├── body-codec.test.ts       # exact canonicalization fixtures
│   │   ├── provenance.test.ts       # semantic JSON comparison
│   │   ├── verify.test.ts           # each mismatch/unknown path
│   │   └── outcomes.test.ts         # result invariants and retry safety
│   ├── contract/
│   │   ├── blogger-adapter.test.ts  # exact URLs/methods/payloads/error mapping
│   │   ├── create-draft.test.ts     # at-most-one insert under every failure
│   │   ├── inspect-draft.test.ts    # read-only behavior and outcome mapping
│   │   └── mcp-surface.test.ts      # tools/list is exactly the accepted two tools
│   └── live/
│       └── blogger-gate.test.ts     # opt-in, exactly-one-create real Blogger gate
├── devpost/
│   ├── learner-profile.md           # learning and collaboration context
│   ├── scope.md                     # approved product boundary
│   ├── prd.md                       # approved behavior and acceptance criteria
│   └── spec.md                      # this technical blueprint
├── .env.example                     # safe names and placeholder path shapes only
├── .gitignore                       # excludes env and credential/token patterns
├── package.json                     # scripts, declared dependency ranges, Node engine
├── package-lock.json                # committed exact dependency graph
├── tsconfig.json                    # strict NodeNext/ESM build configuration
├── vitest.config.ts                 # excludes live tests from default test command
└── README.md                        # setup, auth, MCP host, demo, and safety boundary
```

Generated `dist/`, coverage output, local `.env`, and all credential material are ignored and are not part of the committed tree.

## External Services and Dependencies

### Google OAuth 2.0

- Authorization endpoint: `GET https://accounts.google.com/o/oauth2/v2/auth`
- Required parameters include Desktop client ID, loopback `redirect_uri`, `response_type=code`, `scope=https://www.googleapis.com/auth/blogger`, random `state`, `code_challenge`, `code_challenge_method=S256`, and `access_type=offline`.
- Token endpoint: `POST https://oauth2.googleapis.com/token`
- Code exchange includes the authorization code, matching loopback redirect URI, client identity required by the downloaded Desktop client, and retained `code_verifier`.
- Runtime refresh is handled internally by `google-auth-library` from the external token file.
- The Blogger write scope is required for insert; the readonly scope alone is insufficient. [Blogger OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes#blogger)
- A refresh token is not guaranteed on repeated consent unless Google issues one; `npm run auth` fails safely if no refresh token is received and does not replace a valid token file with incomplete material.

### Blogger Insert Draft

Implements `prd.md > Create Draft Behavior`.

```http
POST https://www.googleapis.com/blogger/v3/blogs/{configuredBlogId}/posts?isDraft=true
Authorization: Bearer <internal access token>
Content-Type: application/json

{
  "title": "validated title",
  "content": "<p>deterministic HTML</p>",
  "labels": ["validated", "unique", "labels"],
  "customMetaData": "{\"schema_version\":1,\"artifact_id\":\"...\",\"version_id\":\"...\"}"
}
```

- The URL base is a constant, blog ID comes only from validated startup configuration, and `isDraft=true` is hard-coded.
- No publish endpoint or requested publication state exists.
- A successful response is parsed only for the fields needed as initial evidence; verification still requires a separate get.
- Official method reference: [Posts: insert](https://developers.google.com/blogger/docs/3.0/reference/posts/insert).

### Blogger Admin Read-Back

Implements `prd.md > Inspect and Verify Behavior`.

```http
GET https://www.googleapis.com/blogger/v3/blogs/{configuredBlogId}/posts/{validatedPostId}?view=ADMIN
Authorization: Bearer <internal access token>
```

The adapter consumes only `id`, `blog.id`, `status`, `title`, `content`, `labels`, and `customMetaData`. [Posts: get](https://developers.google.com/blogger/docs/3.0/reference/posts/get) and [Posts resource](https://developers.google.com/blogger/docs/3.0/reference/posts).

### Quota, Cost, and Availability

- The POC uses a real Google account, a Google Cloud OAuth client, Blogger API v3, and a dedicated permitted test blog.
- Official Blogger reference material does not publish fixed label maxima or a universal request-rate number in the Posts schema. Project-specific quota and API enablement must be checked in the Google Cloud console before the live gate.
- No paid application service is introduced by this architecture, but Google account/API policy and quota remain external dependencies.
- `customMetaData` deprecation is the material compatibility risk and is resolved only by the first live gate.

## Verification Plan

### Deterministic Default Suite

`npm test` performs no live network calls and includes:

- valid/invalid input coverage for both tools;
- exact body fixtures for line endings, paragraphs, `<br>`, entities, blank paragraphs, and unexpected remote HTML;
- label deduplication, Unicode code-point counting, control/comma/whitespace rejection, and set comparison;
- provenance property-order independence, schema validation, and mismatch coverage;
- all create and inspect outcomes and their field invariants;
- fake-adapter assertions proving every `create_draft` invocation calls insert zero or one times, never more;
- adapter contract assertions for the exact base URL, configured target, HTTP methods, query parameters, body fields, and error mapping;
- stdout discipline and redaction tests for known credential-shaped fixtures;
- startup tests proving invalid configuration fails before stdio connection; and
- an MCP client `tools/list` test proving the complete advertised surface is exactly `create_draft` and `inspect_draft`, with explicit schemas and no extra tool.

The last test is the deterministic proof that public publishing authority is absent. It does not depend on Blogger availability or the live gate.

### First Live Blogger Gate

The live test is excluded from `npm test`. It runs only through an explicit command such as:

```bash
BLOGGER_LIVE_TEST=1 npm run test:live
```

Before its single create attempt, it validates configuration, token readiness, and the full test payload locally. The one payload is chosen to exercise:

- paragraph and intra-paragraph line breaks;
- HTML-sensitive authored characters;
- exactly 20 unique labels totaling exactly 200 Unicode code points;
- versioned `customMetaData`; and
- a clearly recognizable test-only title and source reference.

The gate then:

1. calls insert exactly once with `isDraft=true`;
2. records the returned post ID if available;
3. retrieves that ID with `view=ADMIN`;
4. establishes `status === "DRAFT"` and the configured blog ID;
5. proves body reconstruction equals the canonical source body;
6. proves the boundary label set round-trips exactly;
7. proves parsed `customMetaData` contains the unchanged three logical provenance fields; and
8. invokes the independent inspection path against the same post and obtains `VERIFIED`.

No failure triggers a second insert or automatic cleanup. If the effect is unknown, the report says retry is unsafe. If a post ID is known, it is reported for human inspection and later manual cleanup. If provenance does not round-trip, live build work stops and this specification is reopened before any substitute is designed.

This gate proves one real tested path and the selected POC boundary payload, not Blogger's global limits or indefinite future compatibility.

### Demo Acceptance

The recorded demo and evidence must establish all items in `scope.md > What “Working” Looks Like` and the relevant PRD acceptance criteria:

- one real private draft with the expected visible content and labels;
- create result `VERIFIED` with target, post ID, source, status, and six checks;
- later independent `inspect_draft` result `VERIFIED`;
- deterministic mismatch test showing changed body, status, label set, target, or provenance cannot return `VERIFIED`; and
- `tools/list` showing only the two accepted tools.

## Important Failure Modes

- **Configuration or credentials are missing, malformed, unsafe, or cannot refresh** → process exits before stdio becomes usable; stderr identifies the category and path variable without printing file contents or tokens.
- **The single insert has an inconclusive transport/server result** → return `REMOTE_EFFECT_UNKNOWN`, `remote_effect: "unknown"`, and `retry_safe: false`; do not retry.
- **Insert returns an identity but read-back fails or omits a required fact** → return `CREATED_UNVERIFIED` with known identity/evidence and `retry_safe: false`; do not recreate.
- **Read-back is complete but differs materially** → return `MISMATCH` with independently visible failed checks; never repair or update.
- **Deprecated `customMetaData` is absent, stripped, or changed in the first live gate** → stop the live build path and reopen the specification; no fallback is activated.
- **Blogger returns HTML outside the narrow accepted paragraph/line-break structure** → body is not declared a match; return an inconclusive or mismatch outcome according to the facts established.

## What Was Simplified and Why

- **Local stdio only** instead of Streamable HTTP or hosting — remote transport, deployment, exposure, and remote credential storage do not help prove the draft-only authority boundary.
- **Environment-only configuration** instead of a second local configuration schema — one authority removes precedence ambiguity.
- **One fixed blog** instead of caller-selected targets — bounds effects and makes the target check meaningful.
- **Two explicit REST methods** instead of the generated general Blogger client — keeps remote authority inspectable and error semantics explicit.
- **Plain text with deterministic `<p>`/`<br>` HTML** instead of rich HTML authoring — proves authored-text projection without sanitization/editor complexity.
- **One create attempt with a fail-closed uncertain outcome** instead of retries, deduplication, or reconciliation — preserves safety before idempotency exists.
- **Remote post metadata only** instead of a local provenance database — independent inspection can recover origin without adding storage, while the live gate tests the deprecated mechanism.
- **Manual cleanup through Blogger** instead of an MCP delete tool — cleanup authority is outside the product surface.
- **Local recorded demo** instead of deployment — a video and public repository satisfy submission needs without broadening the architecture.

## Decisions and Open Issues

### Accepted Decisions

- The learner selected Node.js/TypeScript, local stdio MCP, local server-held Desktop OAuth credentials, one configured target, the real Blogger API, and a local recorded demo.
- The learner selected environment variables as the only POC configuration authority: `BLOGGER_BLOG_ID`, `BLOGGER_OAUTH_CLIENT_FILE`, and `BLOGGER_TOKEN_FILE`.
- The learner selected a narrow hand-written REST adapter and `google-auth-library` for credential/token handling rather than a broad generated Blogger client.
- The learner selected exactly two schema-declared MCP tools and required `structuredContent` plus an equivalent JSON `TextContent` compatibility projection.
- The learner required a committed npm lockfile.
- The learner placed the absence-of-publish proof in a deterministic `tools/list` contract test rather than the live Blogger test.
- The learner accepted exact plain-text/body algorithms and conservative product-owned label guardrails, with an early live boundary check that does not claim to establish Blogger's true maxima.

### Useful Unknown Clarified

The genuine Blogger-specific uncertainty was where durable, non-reader-facing provenance could live. Current official Posts documentation lists title, HTML content, labels, target, and status but omits per-post custom metadata; the live discovery schema still contains `customMetaData` and marks it deprecated. The learner chose it as a gated mechanism because it is the only available field aligned with the PRD without contaminating visible body or labels. A single-attempt live insert → ADMIN get round-trip is the first build gate. Failure is a specification-blocking discovery event, not permission to improvise a fallback.

### Open Issues

No unresolved architectural choice blocks implementation.

The following are evidence gates, not silently delegated design choices:

1. Confirm the configured Google project/account can enable Blogger API v3 and complete the Desktop OAuth flow with offline access.
2. Confirm one real draft round-trips deprecated `customMetaData`; failure reopens the spec.
3. Confirm Blogger's real HTML representation round-trips the exact canonicalization boundary sample.
4. Confirm one 20-label, 200-code-point test payload succeeds; this validates only the POC guardrail payload.
