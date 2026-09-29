---
doc: spec
status: approved
---

# Draft-Only Blogger MCP — Technical Spec

## How This Works, In Plain Language

This project is a local TypeScript program that an MCP host starts over stdio. It exposes exactly two tools: `create_draft` and `inspect_draft`. The caller supplies finished text and source identifiers, but never supplies a blog ID, publication state, Google credential, URL, HTTP method, or generic Blogger operation.

At startup, the server reads one configured Blogger blog ID, two paths to credential files, and one path to the provenance sidecar from environment variables. It validates that configuration and establishes that the OAuth credential can provide an access token before connecting the MCP server. Secret credentials remain in owner-only files outside the repository and never enter MCP requests or results; non-secret provenance identifiers enter only the accepted tool contracts and bounded provenance evidence.

For creation, the server validates the complete projection, converts the plain-text body into one deterministic HTML representation, and makes at most one request to create a private draft. Once Blogger supplies a usable post ID, the server attempts to persist the source reference in an owner-controlled JSON sidecar keyed by configured `blog_id + post_id`, performs the ADMIN read-back even if that persistence failed, re-reads the sidecar, and compares all six material facts. Only a complete match is `VERIFIED`. An uncertain create is a fail-closed stop and is never retried automatically.

For later inspection, the server retrieves one caller-identified post from the same configured blog, independently looks up its provenance in the sidecar, and runs the same checks without changing anything. Blogger is projection truth; the sidecar is provenance truth only. The Blogger adapter is deliberately limited to one insert route and one get route. Public publishing is absent from the MCP surface and from the adapter.

This shape proves the authority boundary in `scope.md > The Unique Kernel` without adding a web server, hosting, a database, synchronization, or general Blogger administration.

## The Core Journey Through the System

Implements `prd.md > The Core Journey`.

1. An MCP host starts the local process. Configuration and OAuth readiness are checked before the two tools become usable.
2. The caller invokes `create_draft` with a title, plain-text body, optional labels, and `{artifact_id, version_id}`.
3. The tool schema and domain validator reject the entire request before Blogger is contacted if any input is invalid.
4. The body codec escapes authored characters and converts the accepted plain text to deterministic `<p>` and `<br>` markup.
5. The narrow adapter issues exactly one `POST` to the configured blog with `isDraft=true`. No automatic create retry exists.
6. If Blogger returns a usable post ID, the provenance store attempts a non-overwriting sidecar write under configured `blog_id + post_id`.
7. With a known post ID, the adapter issues a `GET` for that identity from the same configured blog with `view=ADMIN`, including when provenance persistence failed.
8. The provenance store re-reads the committed record, and the verifier compares target, draft status, title, reconstructed canonical body, exact label set, and sidecar provenance.
9. The result mapper applies the accepted precedence: any `MISMATCH`, otherwise any `UNKNOWN`, otherwise all six `MATCH`; the MCP tool returns that structured outcome and an equivalent JSON text projection.
10. Later, `inspect_draft` accepts the post ID and expected projection, performs the admin `GET` plus an independent sidecar lookup, and reports current Blogger projection truth and provenance truth using the same verifier.

```text
MCP host
   │ stdio: create_draft / inspect_draft
   ▼
MCP schemas and tool handlers
   │ validated domain request
   ▼
Projection codecs + verification engine
   │
   ├── explicit insert/get commands
   │      ▼
   │   Narrow Blogger adapter ── OAuth headers from local credential provider
   │      ├── POST configured blog /posts?isDraft=true   (create only)
   │      └── GET  configured blog /posts/{postId}?view=ADMIN (read only)
   │
   └── exact blog_id + post_id key
          ▼
       Owner-controlled provenance sidecar (read/write on create; read only on inspect)
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

Exactly four environment variables configure the POC:

```dotenv
BLOGGER_BLOG_ID=1234567890123456789
BLOGGER_OAUTH_CLIENT_FILE=/absolute/path/outside/repository/client_secret.json
BLOGGER_TOKEN_FILE=/absolute/path/outside/repository/blogger-token.json
BLOGGER_PROVENANCE_FILE=/absolute/path/outside/repository/blogger-provenance.json
```

- `BLOGGER_BLOG_ID` is a non-empty decimal Blogger blog identifier and is never accepted from an MCP caller.
- All three file paths must be absolute and resolve outside the repository. Their existence checks are phase-specific:
  - `BLOGGER_OAUTH_CLIENT_FILE` must already exist as a non-symlink regular file owned by the current user, with no group/other permission bits on POSIX systems.
  - During `npm run auth`, `BLOGGER_TOKEN_FILE` may be absent. Its existing parent directory must resolve outside the repository, be owned by the current user, and not be group/other writable. If the token target already exists, it must itself be a non-symlink regular file with owner-only permissions before replacement is allowed.
  - During normal MCP startup, `BLOGGER_TOKEN_FILE` must already exist as a non-symlink regular file owned by the current user, with no group/other permission bits.
  - During normal MCP startup, `BLOGGER_PROVENANCE_FILE` may be absent. Its existing parent directory must resolve outside the repository, be owned by the current user, and not be group/other writable. If the sidecar exists, it must be a non-symlink regular file owned by the current user with mode `0600`. Its contents are read and strictly classified by the provenance store during each create or inspect operation so supported domain outcomes can report absent, unreadable, corrupt, unsupported, locked, or integrity-conflicted state. An absent sidecar is created only during an authorized provenance write after Blogger supplies a usable post ID.
- `.env.example` contains names and placeholder path shapes only. `.env`, client files, token files, provenance sidecars, adjacent provenance locks, temporary replacement files, and common credential filename patterns are ignored by Git.
- Environment variables are the only configuration authority. A local `.env` is merely one way Node populates `process.env`; there is no second config-file schema or precedence system.

### First-Time Authentication

1. Create a Google Desktop OAuth client, enable Blogger API v3, and place the downloaded client file outside the repository with owner-only permissions.
2. Set the four environment variables, directly or in an ignored local `.env`.
3. Run `npm ci`, then `npm run auth`.
4. The auth command binds an HTTP listener to `127.0.0.1` on an available port, generates random `state`, generates a PKCE verifier/challenge using `S256`, requests `access_type=offline` with the Blogger scope, and opens the system browser.
5. The loopback callback must contain the expected state and an authorization code. State comparison is timing-safe. The command exchanges the code locally using the retained PKCE verifier.
6. The command requires a refresh token, revalidates the token target immediately before replacement, writes a same-directory temporary file with mode `0600`, and atomically renames it to `BLOGGER_TOKEN_FILE`. A first-time token target need not exist. The command emits only a bounded success message containing no token or secret value.
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

1. validates all four environment values;
2. requires both OAuth JSON files to exist, validates their shapes and owner-only safety, and validates the provenance target's outside-repository parent plus any existing sidecar's path, ownership, type, and permissions without reading its logical records or creating or changing it;
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
    "BLOGGER_TOKEN_FILE": "/absolute/external/path/blogger-token.json",
    "BLOGGER_PROVENANCE_FILE": "/absolute/external/path/blogger-provenance.json"
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

Reads only the four named environment variables, rejects missing/relative/unsafe paths, applies the auth-bootstrap or runtime file-existence rules for the active command, validates OAuth file shapes plus all applicable path ownership, type, and permission constraints, constructs the OAuth credential provider, provenance sidecar store, and narrow adapter, and refuses to connect stdio until runtime readiness succeeds. Logical sidecar contents are classified by the provenance store per tool operation rather than converted into a startup failure. It never accepts caller overrides. The OAuth bootstrap command validates only the OAuth paths it uses and never creates or changes the provenance sidecar.

### OAuth Bootstrap Command

Implements the accepted local authentication boundary supporting `prd.md > Interaction Surface`.

Runs only through `npm run auth`. It permits an absent first-use token target after validating its existing parent directory and resolved outside-repository path. It performs Desktop OAuth with loopback `127.0.0.1`, an ephemeral port, random state, PKCE S256, offline access, and the Blogger scope, then atomically stores credential material outside the repository with owner-only permissions. It is not imported into the MCP tool registry.

### OAuth Credential Provider

Supports the Blogger adapter without expanding MCP authority.

Loads the external OAuth client and refresh-token files, refreshes access as needed, and returns authorization headers only to the adapter. It exposes neither token values nor a generic HTTP request function to handlers or callers.

### MCP Server and Contract Surface

Implements `prd.md > Interaction Surface`.

Registers exactly two tools, with explicit Zod input and output schemas:

- `create_draft`
- `inspect_draft`

It registers no resources or prompts. MCP ingress schemas are deliberately permissive at the product-field level: they require a tool-argument object but admit missing or wrongly typed `title`, `body`, `labels`, `source`, `post_id`, and `expected` values into the handler as `unknown`. The strict domain validator then returns the PRD's schema-valid `VALIDATION_FAILED` result with stable issues. A malformed JSON-RPC request or non-object tool-argument envelope remains an MCP protocol error because it never constitutes a product request.

Each handler returns `structuredContent` validated against its output schema and one `TextContent` item containing `JSON.stringify(structuredContent)`. The text is a compatibility projection of the same object, not an independently composed result.

### `create_draft` Tool Handler

Implements `prd.md > Create Draft Behavior`, `prd.md > Retry Boundary`, and `prd.md > Create Outcomes`.

Accepts the permissive MCP ingress object, validates it into an `AuthoredProjection` inside the domain layer, and returns `VALIDATION_FAILED` for product-defined malformed fields before Blogger is contacted. For valid input it requests one adapter insert. Once a usable post ID exists, it attempts non-overwriting provenance persistence, performs ADMIN read-back even if persistence failed, re-reads the sidecar, delegates all six checks to the shared verifier, and maps evidence using the accepted mismatch-before-unknown precedence. It contains no retry loop, never calls insert more than once per invocation, and performs no compensating Blogger mutation.

### `inspect_draft` Tool Handler

Implements `prd.md > Inspect and Verify Behavior` and `prd.md > Inspect Outcomes`.

Accepts a permissive MCP ingress object, validates its Blogger post ID and expected projection inside the domain layer, and returns `VALIDATION_FAILED` for product-defined malformed fields. For valid input it performs one read-only adapter get from the configured blog, independently reads the sidecar record under configured `blog_id + post_id`, and maps the six checks through the shared verifier. It cannot update, repair, recreate, publish, delete, or mutate provenance.

### Projection Validator

Implements `prd.md > Input Contract`.

Validates title, body, labels, source identifiers, and post ID before an adapter call. It derives the expected normalized label set, canonical body, HTML body, and schema-versioned provenance record fields. Validation issues use stable field paths and codes.

### Plain-Text Body Codec

Implements `prd.md > Verification Semantics`.

Owns both the forward plain-text-to-HTML algorithm and the reverse Blogger-HTML-to-canonical-text algorithm defined under **Body Representation and Canonicalization**. It performs no generic rendered-text or browser-layout comparison.

### Provenance Sidecar Store

Implements `prd.md > Durable Provenance`.

Owns the one schema-versioned JSON sidecar configured by `BLOGGER_PROVENANCE_FILE`. It derives the exact `blog_id + ":" + post_id` key, strictly validates both store-level and record-level schema versions, preserves embedded IDs for key-integrity checks, performs non-overwriting record insertion through an adjacent exclusive lock and atomic full-file replacement, and exposes typed persist and lookup operations. It never stores credentials or article projection data and grants no Blogger authority.

### Verification Engine

Implements `prd.md > Verification Semantics`.

Pure domain code that compares expected and observed target, status, title, body, labels, and provenance. It emits one independently visible check per property. Blogger supplies the first five observed facts; the sidecar supplies provenance. A valid sidecar record with different artifact or version identifiers is `MISMATCH`; an absent, unreadable, corrupt, unsupported, locked, write-failed, or integrity-conflicted provenance fact is `UNKNOWN`. A missing fact never becomes an invented mismatch.

### Narrow Blogger REST Adapter

Implements `prd.md > Create Draft Behavior` and `prd.md > Inspect and Verify Behavior`.

Constructs only the two approved Blogger URLs from the fixed base URL, configured blog ID, and validated post ID. It obtains authorization headers internally, sends native `fetch` requests, validates remote JSON with Zod, and classifies HTTP/transport failures. Every Blogger POST and GET has an independent fixed 15-second deadline implemented with `AbortSignal.timeout(BLOGGER_REQUEST_TIMEOUT_MS)`, where the internal constant is `15_000`; it is not caller input or environment configuration. It exposes typed `insertDraft` and `getPostAdmin` methods—not arbitrary URLs, methods, blog IDs, query parameters, timeout overrides, or generic authenticated fetch.

### Result Mapper

Implements `prd.md > Result States` and `prd.md > Output Character`.

Builds the discriminated output unions from verified domain evidence. It keeps requested facts, Blogger evidence, provenance evidence, confirmed mismatches, and unknown facts separate. After a successful create read-back, any confirmed `MISMATCH` dominates any `UNKNOWN`; otherwise any `UNKNOWN` maps to `CREATED_UNVERIFIED`, and only six `MATCH` checks map to `VERIFIED`. Inspect uses the same precedence with `REMOTE_UNKNOWN` for the unknown branch. It also sets `remote_effect` and `retry_safe` explicitly for create outcomes.

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
type CreateDraftIngress = {
  title?: unknown;
  body?: unknown;
  labels?: unknown;
  source?: unknown;
  [additionalField: string]: unknown;
};
```

The registered MCP input schema admits these product fields as optional `unknown` values and preserves unexpected fields for the domain validator to reject with stable issues. Only successful strict validation produces an `AuthoredProjection`. This intentionally prevents MCP SDK pre-handler validation from converting approved product-validation cases into `InvalidParams`.

### `inspect_draft` Input

```ts
type InspectDraftIngress = {
  post_id?: unknown;
  expected?: unknown;
  [additionalField: string]: unknown;
};
```

The strict domain validator requires `post_id` to be a non-empty decimal Blogger post identifier and `expected` to become an `AuthoredProjection`. The validated post ID is inserted only into the fixed post-ID path segment. Missing, non-string, or otherwise malformed product fields return `VALIDATION_FAILED`; only a non-object MCP argument envelope remains a protocol-level `InvalidParams` case.

### Structured Evidence

```ts
type CheckName =
  | "target"
  | "status"
  | "title"
  | "body"
  | "labels"
  | "provenance";

type ProvenanceErrorCode =
  | "PROVENANCE_RECORD_ABSENT"
  | "PROVENANCE_STORE_UNREADABLE"
  | "PROVENANCE_STORE_CORRUPT"
  | "PROVENANCE_SCHEMA_UNSUPPORTED"
  | "PROVENANCE_KEY_INTEGRITY_CONFLICT"
  | "PROVENANCE_WRITE_FAILED"
  | "PROVENANCE_LOCK_CONTENDED"
  | "PROVENANCE_STALE_LOCK"
  | "PROVENANCE_VALUE_MISMATCH";

type VerificationCheck = {
  name: CheckName;
  result: "MATCH" | "MISMATCH" | "UNKNOWN";
  expected: unknown;
  observed?: unknown;
  code?: ProvenanceErrorCode;
  detail?: string;
};

type RemotePostEvidence = {
  post_id: string;
  blog_id?: string;
  status?: string;
  title?: string;
  canonical_body?: string;
  labels?: string[];
};

type ProvenanceRecord = {
  schema_version: 1;
  blog_id: string;
  post_id: string;
  artifact_id: string;
  version_id: string;
};

type ProvenanceEvidence = {
  storage: "owner_sidecar";
  key: {
    blog_id: string;
    post_id: string;
  };
  record?: ProvenanceRecord;
};

type ValidationIssue = {
  path: string;
  code: string;
  message: string;
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

type ValidationFailedCreateResult = {
  action: "create_draft";
  outcome: "VALIDATION_FAILED";
  message: string;
  target: { blog_id: string };
  requested_raw?: unknown;
  issues: ValidationIssue[];
  remote_effect: "none";
  retry_safe: true;
  error: {
    code: "INPUT_VALIDATION_FAILED";
    phase: "validation";
    detail: string;
  };
};

type ValidatedCreateResult = {
  action: "create_draft";
  outcome: Exclude<CreateOutcome, "VALIDATION_FAILED">;
  message: string;
  target: { blog_id: string };
  requested: AuthoredProjection;
  remote_effect: "none" | "created" | "unknown";
  retry_safe: boolean;
  remote?: RemotePostEvidence;
  provenance?: ProvenanceEvidence;
  checks?: VerificationCheck[];
  error?: {
    code: string;
    phase: "auth" | "create" | "read_back" | "verification" | "provenance";
    detail: string;
  };
};

type CreateDraftResult =
  | ValidationFailedCreateResult
  | ValidatedCreateResult;
```

Outcome invariants:

- `VALIDATION_FAILED`: domain validation receives the permissive ingress object, makes no Blogger call, returns stable `issues`, may include `requested_raw`, and sets `remote_effect: "none"`; `retry_safe: true`. It never falsely types malformed input as `AuthoredProjection`.
- `CREATE_FAILED`: authorization-header/token acquisition fails before `fetch` is issued, or Blogger returns a definitive client rejection establishing no creation (for example `400`, `401`, or `403`); `remote_effect: "none"`; `retry_safe: true`.
- `REMOTE_EFFECT_UNKNOWN`: timeout, connection loss, `408`, `429`, `5xx`, or another condition where no reliable Blogger success response or post identity was received even though the request may have reached Blogger; `remote_effect: "unknown"`; `retry_safe: false`.
- `CREATED_UNVERIFIED`: a Blogger `2xx` insert response or post identity establishes a draft effect, but the response cannot provide an ID for read-back, read-back fails, or at least one required check is `UNKNOWN` with no confirmed mismatch; `remote_effect: "created"`; `retry_safe: false`. Provenance persistence or lookup failure contributes an `UNKNOWN` provenance check but does not by itself override a confirmed mismatch.
- `MISMATCH`: read-back succeeded and at least one material check is `MISMATCH`, including a valid sidecar record for the same key with different artifact or version identifiers; `remote_effect: "created"`; `retry_safe: false`.
- `VERIFIED`: all six checks are `MATCH`; `remote_effect: "created"`; `retry_safe: false`.

The insert-attempt boundary is crossed immediately before invoking `fetch` for the POST. Once crossed, an indeterminate effect cannot map to `CREATE_FAILED`; it must map to `REMOTE_EFFECT_UNKNOWN` with `retry_safe: false`. No outcome after an insert attempt causes another insert.

Once a usable post ID exists, provenance persistence is attempted before ADMIN read-back. ADMIN read-back still occurs after provenance persistence failure. After read-back, the sidecar is re-read and all six checks are classified with this precedence: any `MISMATCH` → `MISMATCH`; otherwise any `UNKNOWN` → `CREATED_UNVERIFIED`; all six `MATCH` → `VERIFIED`. If ADMIN read-back cannot establish the created post, the existing `CREATED_UNVERIFIED` behavior remains.

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

type ValidationFailedInspectResult = {
  action: "inspect_draft";
  outcome: "VALIDATION_FAILED";
  message: string;
  target: { blog_id: string; post_id?: string };
  requested_raw?: unknown;
  issues: ValidationIssue[];
  error: {
    code: "INPUT_VALIDATION_FAILED";
    phase: "validation";
    detail: string;
  };
};

type ValidatedInspectResult = {
  action: "inspect_draft";
  outcome: Exclude<InspectOutcome, "VALIDATION_FAILED">;
  message: string;
  target: { blog_id: string; post_id: string };
  expected: AuthoredProjection;
  remote?: RemotePostEvidence;
  provenance?: ProvenanceEvidence;
  checks?: VerificationCheck[];
  error?: {
    code: string;
    phase: "auth" | "read" | "verification" | "provenance";
    detail: string;
  };
};

type InspectDraftResult =
  | ValidationFailedInspectResult
  | ValidatedInspectResult;
```

- Blogger `404` maps to `ABSENT`.
- Blogger `401` or `403` maps to `ACCESS_DENIED`.
- Transport failure, timeout, `408`, `429`, `5xx`, or an unparseable response maps to `REMOTE_UNKNOWN`.
- A readable post with any `MISMATCH` check maps to `MISMATCH`, including a valid sidecar record for the requested key with different artifact or version identifiers.
- A readable post with an `UNKNOWN` required check but no confirmed mismatch maps to `REMOTE_UNKNOWN`.
- Only six `MATCH` checks map to `VERIFIED`.

### MCP `isError` Policy

Every declared create and inspect outcome—including `VALIDATION_FAILED`, `CREATE_FAILED`, `CREATED_UNVERIFIED`, `MISMATCH`, `REMOTE_EFFECT_UNKNOWN`, `ABSENT`, `ACCESS_DENIED`, and `REMOTE_UNKNOWN`—is a normal schema-validating MCP tool result. The handler returns `structuredContent` conforming to the declared output union, the equivalent JSON `TextContent`, and either omits `isError` or sets `isError: false`.

`isError: true` or a thrown tool exception is reserved for an unexpected internal defect that cannot truthfully be represented by the specified domain union, such as an invariant violation or programming error. Such a tool-level failure returns only a sanitized diagnostic, does not fabricate a declared outcome, and never includes credentials, tokens, authorization headers, raw secret-file content, or an unsanitized stack trace. This separation keeps all anticipated operational failures machine-branchable and subject to output-schema validation.

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

One owner-controlled JSON sidecar outside the repository is sufficient for this local POC. Its absolute path comes only from `BLOGGER_PROVENANCE_FILE`. The file is keyed by the configured decimal Blogger blog ID and returned decimal post ID, joined by a colon. Generic store data has this exact shape:

```json
{
  "schema_version": 1,
  "records": {
    "1234567890123456789:9876543210987654321": {
      "schema_version": 1,
      "blog_id": "1234567890123456789",
      "post_id": "9876543210987654321",
      "artifact_id": "artifact-example",
      "version_id": "version-example"
    }
  }
}
```

The top-level `schema_version` versions the complete store format. Each keyed record independently contains `schema_version: 1` to version the provenance-record format. Correctness never depends on JSON property order or byte-identical serialization.

Strict validation and stable non-secret error codes are:

- no record for the requested key, including an absent store during lookup → `PROVENANCE_RECORD_ABSENT`;
- filesystem or permission failure while reading the store → `PROVENANCE_STORE_UNREADABLE`;
- malformed JSON or a store/record shape that cannot satisfy the strict schema → `PROVENANCE_STORE_CORRUPT`;
- unsupported top-level or record-level schema version → `PROVENANCE_SCHEMA_UNSUPPORTED`;
- disagreement between the record key and embedded `blog_id` or `post_id` → `PROVENANCE_KEY_INTEGRITY_CONFLICT`;
- temporary-file, flush, rename, parent-flush, or committed-record re-read failure during persistence → `PROVENANCE_WRITE_FAILED`;
- an existing lock whose writer is active or cannot be established as inactive → `PROVENANCE_LOCK_CONTENDED`;
- a lock whose recorded owner is conclusively inactive → `PROVENANCE_STALE_LOCK`; and
- a fully valid record for the requested key whose `artifact_id` or `version_id` differs from expectations → `PROVENANCE_VALUE_MISMATCH`.

All conditions above except `PROVENANCE_VALUE_MISMATCH` make the provenance check `UNKNOWN`. `PROVENANCE_VALUE_MISMATCH` is a confirmed provenance `MISMATCH`. Only a fully valid record with supported store and record schema versions, matching key and embedded IDs, and exact artifact/version identifiers produces provenance `MATCH`.

### Create Ordering and Non-Overwriting Semantics

1. Validate the full authored projection and runtime configuration.
2. Make at most one Blogger create attempt.
3. If the Blogger effect is unknown, return `REMOTE_EFFECT_UNKNOWN`; do not write speculative provenance.
4. If no usable post ID is established, preserve the existing `CREATED_UNVERIFIED` behavior.
5. With a usable post ID, acquire the sidecar write lock and attempt to persist the requested record under configured `blog_id + post_id`.
6. If the key already contains an identical valid record, treat it as the same fact and do not rewrite it. If it contains a valid record with different artifact or version identifiers, never overwrite it; the provenance check is `MISMATCH`.
7. Perform Blogger ADMIN read-back whenever the post ID is known, including after provenance persistence failure.
8. Re-read the committed sidecar record and perform all six checks.
9. Apply create precedence: any confirmed `MISMATCH` → `MISMATCH`; otherwise any `UNKNOWN` → `CREATED_UNVERIFIED`; all six `MATCH` → `VERIFIED`.

No provenance failure triggers another Blogger create or any compensating Blogger update, delete, publish, schedule, cleanup, or target change.

### Inspect Lookup Semantics

`inspect_draft` derives exactly one key from the configured blog ID and validated post ID. It reads Blogger projection truth and sidecar provenance truth independently. It never searches by artifact or version identifier and never repairs or writes a record. Inspect precedence is any confirmed `MISMATCH` → `MISMATCH`; otherwise any `UNKNOWN` → `REMOTE_UNKNOWN`; all six `MATCH` → `VERIFIED`.

### Atomicity, Locking, and Crash Consistency

- A writer creates an adjacent owner-only lock using exclusive creation before reading or changing the store. Lock metadata may contain only non-secret operational fields needed to identify the local writer.
- A present active or indeterminate lock fails closed. A conclusively stale lock also fails closed. The process never steals or removes a lock automatically.
- Manual stale-lock removal is permitted only after the operator establishes that no active writer owns it.
- Inspect fails closed with an `UNKNOWN` provenance check while a live, stale, or indeterminate writer lock exists; it does not treat a transient old snapshot as current provenance truth.
- A missing store begins as an empty schema-version-1 document only during an authorized write.
- Persistence serializes the complete updated document to a same-directory temporary file with mode `0600`, flushes it, atomically renames it over the target, and flushes the parent directory where supported.
- A crash before rename leaves the prior complete store intact. A crash after rename leaves the new complete store and may leave a stale lock requiring the documented manual recovery.
- After replacement, the writer re-opens and strictly validates the committed record before it can report provenance `MATCH`.

The sidecar, lock, and temporary files are outside the repository and owner-controlled. They contain no OAuth client data, tokens, authorization headers, authorization URLs, titles, bodies, labels, raw Blogger request bodies, or publication authority. Provenance never falls back to Blogger body, title, labels, `customMetaData`, a caller-held receipt, or another hidden mechanism.

## Data Model

No application database is used. One owner-controlled JSON sidecar persists provenance only.

| Data | Origin | Where it lives | Update and return behavior |
|---|---|---|---|
| Configured blog ID | `BLOGGER_BLOG_ID` | Process environment | Immutable for one process. The caller cannot override it. |
| Provenance sidecar path | `BLOGGER_PROVENANCE_FILE` | Process environment | Immutable for one process. Absolute, outside the repository, and never caller-controlled. |
| OAuth client material | Google Desktop client JSON | Owner-only file outside repository | Read during auth/runtime initialization; never returned. |
| Refresh/access credentials | OAuth bootstrap/token refresh | Owner-only token file outside repository; access token also in process memory | Token file written atomically by auth bootstrap; library refreshes access in memory. Never returned. |
| Authored projection | MCP caller | One tool invocation in memory | Validated before remote access; included as non-secret requested evidence in result. |
| Canonical body and labels | Projection validator/codecs | One invocation in memory | Deterministically derived; recomputed on later inspection from caller expectations. |
| Durable source reference | MCP caller | Owner-controlled JSON sidecar keyed by configured `blog_id + post_id` | Persisted only after Blogger supplies a usable post ID; non-overwriting; independently re-read for create verification and later inspection. |
| Remote draft | Blogger | Configured Blogger blog | Created once; never updated, published, scheduled, or deleted by this server. |
| Verification evidence | Expected projection + Blogger read-back + sidecar lookup | One invocation result | Blogger and provenance evidence remain separate and are rebuilt on every create read-back or inspect call. |

When the process exits, the external OAuth files, provenance sidecar, and Blogger draft remain. A later `inspect_draft` does not need the original create receipt because it receives expectations, reads Blogger projection truth, and independently recovers provenance from the sidecar.

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
│   ├── provenance/
│   │   ├── sidecar-store.ts         # strict lookup and atomic non-overwriting persistence
│   │   └── errors.ts                # stable non-secret provenance classifications
│   ├── domain/
│   │   ├── contracts.ts            # input/output/result discriminated unions
│   │   ├── projection.ts           # title/source/label validation and normalization
│   │   ├── body-codec.ts           # exact forward/reverse body algorithms
│   │   ├── provenance.ts           # store/record schemas, key derivation, comparison
│   │   ├── verify.ts               # six independent material checks
│   │   └── outcomes.ts             # evidence-to-outcome mapping and invariants
│   └── tools/
│       ├── create-draft.ts          # one-attempt create and read-back orchestration
│       └── inspect-draft.ts         # read-only inspection orchestration
├── test/
│   ├── unit/
│   │   ├── projection.test.ts       # validation and label guardrails
│   │   ├── body-codec.test.ts       # exact canonicalization fixtures
│   │   ├── provenance.test.ts       # record schema, integrity, and comparison
│   │   ├── provenance-store.test.ts # atomicity, locking, non-overwrite, error mapping
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

Generated `dist/`, coverage output, local `.env`, credential material, provenance sidecars, provenance locks, and sidecar temporary files are ignored and are not part of the committed tree.

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
  "labels": ["validated", "unique", "labels"]
}
```

- The URL base is a constant, blog ID comes only from validated startup configuration, and `isDraft=true` is hard-coded.
- No provenance field or marker is sent to Blogger.
- No publish endpoint or requested publication state exists.
- A successful response is parsed only for the fields needed as initial evidence; verification still requires a separate get.
- Official method reference: [Posts: insert](https://developers.google.com/blogger/docs/3.0/reference/posts/insert).

### Blogger Admin Read-Back

Implements `prd.md > Inspect and Verify Behavior`.

```http
GET https://www.googleapis.com/blogger/v3/blogs/{configuredBlogId}/posts/{validatedPostId}?view=ADMIN
Authorization: Bearer <internal access token>
```

The adapter consumes only `id`, `blog.id`, `status`, `title`, `content`, and `labels`. Provenance is not accepted from the Blogger response. [Posts: get](https://developers.google.com/blogger/docs/3.0/reference/posts/get) and [Posts resource](https://developers.google.com/blogger/docs/3.0/reference/posts).

### Blogger Request Deadlines

The adapter defines one internal constant:

```ts
const BLOGGER_REQUEST_TIMEOUT_MS = 15_000;
```

Each POST and GET creates a fresh `AbortSignal.timeout(BLOGGER_REQUEST_TIMEOUT_MS)` and passes it to native `fetch`. The timeout is fixed for this POC: it is not accepted through MCP, configuration, or environment variables. Adapter tests use controlled timers and a non-resolving fetch double to prove that the signal aborts the request and reaches the required mapper branch.

- POST authorization-header acquisition happens before the insert-attempt boundary. If it fails, no Blogger insert was issued: `CREATE_FAILED`, `remote_effect: "none"`, `retry_safe: true`.
- A POST timeout after `fetch` is invoked crosses the effect boundary: `REMOTE_EFFECT_UNKNOWN`, `remote_effect: "unknown"`, `retry_safe: false`.
- A create-flow GET timeout after a known `2xx` insert or post identity: `CREATED_UNVERIFIED`, `remote_effect: "created"`, `retry_safe: false`.
- An inspect-flow GET timeout: `REMOTE_UNKNOWN`.
- An inspect authorization-header acquisition failure before GET also maps to `REMOTE_UNKNOWN`, because current remote state was not established and Blogger did not conclusively refuse access.

No timeout path invokes insert again.

### Quota, Cost, and Availability

- The POC uses a real Google account, a Google Cloud OAuth client, Blogger API v3, and a dedicated permitted test blog.
- Official Blogger reference material does not publish fixed label maxima or a universal request-rate number in the Posts schema. Project-specific quota and API enablement must be checked in the Google Cloud console before the live gate.
- No paid application service is introduced by this architecture, but Google account/API policy and quota remain external dependencies.
- The material local persistence risks are strict sidecar compatibility, owner-only path safety, atomic replacement, and fail-closed locking; they are covered deterministically before the revised live gate.

## Verification Plan

### Deterministic Default Suite

`npm test` performs no live network calls and includes:

- valid/invalid input coverage for both tools;
- MCP ingress tests proving missing and wrongly typed product fields reach the domain validator and return schema-valid `VALIDATION_FAILED`, while only a non-object/protocol-invalid envelope becomes MCP `InvalidParams`;
- exact body fixtures for line endings, paragraphs, `<br>`, entities, blank paragraphs, and unexpected remote HTML;
- label deduplication, Unicode code-point counting, control/comma/whitespace rejection, and set comparison;
- provenance store/record schema validation, store- and record-level unsupported-version handling, key/embedded-ID integrity, exact identifier comparison, and stable error-code coverage;
- sidecar tests for record absence, unreadable/corrupt stores, non-overwriting behavior, atomic full-file replacement, committed-record re-read, lock contention, stale-lock fail-closed behavior, and crash-consistency expectations;
- create/inspect precedence tests proving a confirmed mismatch dominates unknown provenance, otherwise unknown provenance maps to `CREATED_UNVERIFIED` or `REMOTE_UNKNOWN`, and only six `MATCH` checks map to `VERIFIED`;
- all create and inspect outcomes and their field invariants;
- fake-adapter assertions proving every `create_draft` invocation calls insert zero or one times, never more;
- adapter contract assertions for the exact base URL, configured target, HTTP methods, query parameters, body fields, fixed 15-second abort signal, and pre-/post-attempt error mapping;
- auth/bootstrap path tests proving a missing token target is allowed only during bootstrap, existing targets are revalidated before atomic replacement, and normal runtime requires the token file;
- configuration tests proving `BLOGGER_PROVENANCE_FILE` is the fourth and only additional authority, remains outside the repository, and permits only a safe absent target or strict owner-only existing store;
- MCP result tests proving every declared domain outcome returns schema-valid `structuredContent` without `isError: true`, while unexpected invariant defects use the sanitized tool-error path;
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
- a schema-versioned sidecar provenance record; and
- a clearly recognizable test-only title and source reference.

After all deterministic adapter, auth, preflight, sidecar, locking, and outcome-precedence verification passes, the workflow stops before the Blogger `POST`, reports that the revised live gate is ready, and requests one explicit learner authorization for exactly one real private-draft creation. Planning acceptance or deterministic-test authority does not authorize that external effect.

The gate then:

1. calls insert exactly once with `isDraft=true`;
2. records the returned post ID if available;
3. persists the schema-versioned provenance record under configured `blog_id + post_id` using the accepted non-overwriting atomic sidecar path;
4. retrieves that ID with `view=ADMIN`, including if sidecar persistence failed;
5. establishes the configured blog ID, `status === "DRAFT"`, title, canonical body, and exact boundary label set from Blogger;
6. re-reads the sidecar and establishes exact provenance from the valid keyed record;
7. obtains all six `MATCH` checks with separate Blogger and provenance evidence; and
8. invokes the independent inspection path against the same post and obtains `VERIFIED`.

No failure triggers a second insert, automatic cleanup, or compensating Blogger mutation. If the create effect is unknown, the report says retry is unsafe and no speculative provenance record is written. If a post ID is known, it is reported for human inspection and later manual cleanup. There is no fallback provenance in Blogger body, title, labels, `customMetaData`, or a caller-held receipt.

This gate proves one real tested path and the selected POC boundary payload, not Blogger's global limits or indefinite future compatibility.

The approved earlier live contour created Blogger draft `6000476695311698466`. ADMIN read-back confirmed the configured target, `DRAFT` state, title, canonicalized body, and exact label set, but `customMetaData` was absent. The create result was therefore `CREATED_UNVERIFIED`, and independent inspection could not establish durable provenance. This establishes only that the tested contour did not provide a reliable `customMetaData` round-trip contract; it does not establish that Blogger never supports that field.

Draft `6000476695311698466` remains preserved as evidence. The server must not mutate, delete, publish, update, schedule, or create a sidecar record for it. It cannot satisfy the revised live gate.

### Demo Acceptance

The recorded demo and evidence must establish all items in `scope.md > What “Working” Looks Like` and the relevant PRD acceptance criteria:

- one real private draft with the expected visible content and labels;
- create result `VERIFIED` with target, post ID, source, status, and six checks;
- later independent `inspect_draft` result `VERIFIED`;
- deterministic mismatch test showing changed body, status, label set, target, or provenance cannot return `VERIFIED`; and
- `tools/list` showing only the two accepted tools.

## Important Failure Modes

- **Configuration or credentials are missing, malformed, unsafe, or cannot refresh** → process exits before stdio becomes usable; stderr identifies the category and path variable without printing file contents or tokens.
- **Runtime authorization-header acquisition fails before a create POST is issued** → return `CREATE_FAILED`, `remote_effect: "none"`, and `retry_safe: true`; no insert was attempted.
- **The single insert has an inconclusive transport/server result** → return `REMOTE_EFFECT_UNKNOWN`, `remote_effect: "unknown"`, and `retry_safe: false`; do not retry.
- **Insert returns no usable identity** → return `CREATED_UNVERIFIED` with available Blogger evidence and `retry_safe: false`; do not persist speculative provenance or recreate.
- **Provenance persistence or lookup is absent, unreadable, corrupt, unsupported, write-failed, locked, stale-locked, or integrity-conflicted** → emit the stable provenance code with `phase: "provenance"`, mark the provenance check `UNKNOWN`, still perform ADMIN read-back when the post ID is known, and apply normal outcome precedence; never recreate or perform compensating Blogger mutation.
- **A valid sidecar record for the same `blog_id + post_id` has different artifact or version identifiers** → emit `PROVENANCE_VALUE_MISMATCH`, mark provenance `MISMATCH`, and never overwrite the record.
- **Insert returns an identity but ADMIN read-back fails or omits a required Blogger fact** → preserve `CREATED_UNVERIFIED` with known identity/evidence and `retry_safe: false`; do not recreate.
- **Any complete Blogger or provenance check differs materially** → return `MISMATCH` with independently visible failed checks, even if another check is `UNKNOWN`; never repair or update.
- **Blogger returns HTML outside the narrow accepted paragraph/line-break structure** → body is not declared a match; return an inconclusive or mismatch outcome according to the facts established.

## What Was Simplified and Why

- **Local stdio only** instead of Streamable HTTP or hosting — remote transport, deployment, exposure, and remote credential storage do not help prove the draft-only authority boundary.
- **Environment-only configuration** instead of a second local configuration schema — one authority removes precedence ambiguity.
- **One fixed blog** instead of caller-selected targets — bounds effects and makes the target check meaningful.
- **Two explicit REST methods** instead of the generated general Blogger client — keeps remote authority inspectable and error semantics explicit.
- **Plain text with deterministic `<p>`/`<br>` HTML** instead of rich HTML authoring — proves authored-text projection without sanitization/editor complexity.
- **One create attempt with a fail-closed uncertain outcome** instead of retries, deduplication, or reconciliation — preserves safety before idempotency exists.
- **One owner-controlled JSON sidecar** instead of a database or Blogger metadata fallback — this is sufficient for the local POC, supports independent provenance inspection, and keeps reader-facing Blogger content provenance-free.
- **Manual cleanup through Blogger** instead of an MCP delete tool — cleanup authority is outside the product surface.
- **Local recorded demo** instead of deployment — a video and public repository satisfy submission needs without broadening the architecture.

## Decisions and Open Issues

### Accepted Decisions

- The learner selected Node.js/TypeScript, local stdio MCP, local server-held Desktop OAuth credentials, one configured target, the real Blogger API, and a local recorded demo.
- The learner selected environment variables as the only POC configuration authority: `BLOGGER_BLOG_ID`, `BLOGGER_OAUTH_CLIENT_FILE`, `BLOGGER_TOKEN_FILE`, and `BLOGGER_PROVENANCE_FILE`.
- The learner selected a narrow hand-written REST adapter and `google-auth-library` for credential/token handling rather than a broad generated Blogger client.
- The learner selected exactly two schema-declared MCP tools and required `structuredContent` plus an equivalent JSON `TextContent` compatibility projection.
- The learner required a committed npm lockfile.
- The learner placed the absence-of-publish proof in a deterministic `tools/list` contract test rather than the live Blogger test.
- The learner accepted exact plain-text/body algorithms and conservative product-owned label guardrails, with an early live boundary check that does not claim to establish Blogger's true maxima.
- The learner required permissive MCP field ingress plus strict in-handler domain validation so approved malformed-product-input cases return structured `VALIDATION_FAILED` instead of pre-handler `InvalidParams`.
- The learner required phase-specific token-path validation: absence is permitted only for first-use bootstrap, while runtime requires the safe token file to exist.
- The learner accepted one fixed 15-second abortable deadline per Blogger POST or GET and the corresponding effect-aware timeout mappings.
- The learner required every declared domain outcome to remain a schema-validating normal MCP result; `isError` is reserved for unexpected internal defects.
- The learner completed the create invariant: pre-request auth failure or definitive client rejection is retry-safe `CREATE_FAILED`, while indeterminacy after the POST attempt boundary is non-retryable `REMOTE_EFFECT_UNKNOWN`.
- The learner accepted one owner-controlled JSON sidecar keyed by configured `blog_id + post_id`, with top-level and record-level schema versioning, non-overwriting records, atomic full-file replacement, and fail-closed cross-process locking.
- The learner required no automatic stale-lock stealing. Manual stale-lock recovery is permitted only after the operator establishes that no active writer owns the lock.
- The learner accepted separate Blogger and provenance evidence, `provenance` as an error phase for create and inspect, the stable provenance error-code set, and mismatch-before-unknown verification precedence without adding top-level outcomes.

### Useful Unknown Clarified

The approved live contour created draft `6000476695311698466` and confirmed the configured target, `DRAFT` state, title, canonicalized body, and exact boundary label set. `customMetaData` was absent from ADMIN read-back, so the create result was `CREATED_UNVERIFIED` and independent inspection could not establish durable provenance. This evidence applies only to the tested contour; it is not a claim that Blogger never supports the field. Accepted revision R1 replaces the failed mechanism with the owner-controlled sidecar while preserving the durable-provenance requirement, reader-facing-body boundary, outcome set, and one-attempt Blogger authority.

### Open Issues

No unresolved architectural choice blocks implementation. R1 closes the provenance architecture questions.

The following are evidence gates, not silently delegated design choices:

1. Implement and deterministically verify the accepted sidecar, locking, atomicity, evidence, and precedence contracts.
2. After a separate explicit external-effect authorization, confirm one newly created draft passes the revised six-check live gate and later independent inspection.

The earlier evidence draft `6000476695311698466` remains unchanged and receives no retroactive sidecar record; it cannot satisfy the revised live gate.
