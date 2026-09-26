import type { AuthorizationHeaderProvider } from "../auth/oauth-client.js";
import type {
  BloggerAdapter,
  GetPostResult,
  InsertDraftRequest,
  InsertDraftResult,
  RemotePost
} from "../domain/contracts.js";
import { classifyGetHttpFailure, classifyInsertHttpFailure } from "./errors.js";
import { bloggerInsertResponseSchema, bloggerPostResponseSchema } from "./response-schema.js";

const BLOGGER_API_BASE = "https://www.googleapis.com/blogger/v3";
export const BLOGGER_REQUEST_TIMEOUT_MS = 15_000;

type FetchFunction = typeof globalThis.fetch;

export class BloggerRestAdapter implements BloggerAdapter {
  private readonly fetchFn: FetchFunction;
  private readonly timeoutSignal: (milliseconds: number) => AbortSignal;

  constructor(
    private readonly blogId: string,
    private readonly credentialProvider: AuthorizationHeaderProvider,
    dependencies: {
      fetchFn?: FetchFunction;
      timeoutSignal?: (milliseconds: number) => AbortSignal;
    } = {}
  ) {
    if (!/^\d+$/u.test(blogId)) throw new Error("Configured Blogger blog ID is invalid.");
    this.fetchFn = dependencies.fetchFn ?? globalThis.fetch;
    this.timeoutSignal = dependencies.timeoutSignal ?? (milliseconds => AbortSignal.timeout(milliseconds));
  }

  async insertDraft(request: InsertDraftRequest): Promise<InsertDraftResult> {
    let headers: Headers;
    try {
      headers = new Headers(await this.credentialProvider.getAuthorizationHeaders());
    } catch {
      return {
        ok: false,
        kind: "auth",
        code: "AUTHORIZATION_HEADER_FAILED",
        detail: "An authorization header could not be acquired before the insert attempt."
      };
    }
    headers.set("content-type", "application/json");
    const url = `${BLOGGER_API_BASE}/blogs/${encodeURIComponent(this.blogId)}/posts?isDraft=true`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: this.timeoutSignal(BLOGGER_REQUEST_TIMEOUT_MS)
      });
    } catch {
      return {
        ok: false,
        kind: "unknown",
        code: "BLOGGER_INSERT_TRANSPORT_UNKNOWN",
        detail: "The insert attempt ended without a conclusive Blogger response."
      };
    }

    if (!response.ok) return classifyInsertHttpFailure(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: true };
    }
    const parsed = bloggerInsertResponseSchema.safeParse(payload);
    if (!parsed.success || parsed.data.id === undefined) return { ok: true };
    return { ok: true, postId: parsed.data.id };
  }

  async getPostAdmin(postId: string): Promise<GetPostResult> {
    if (!/^\d+$/u.test(postId)) throw new Error("Validated Blogger post ID invariant failed.");
    let headers: Headers;
    try {
      headers = new Headers(await this.credentialProvider.getAuthorizationHeaders());
    } catch {
      return {
        ok: false,
        kind: "auth",
        code: "AUTHORIZATION_HEADER_FAILED",
        detail: "An authorization header could not be acquired before the read attempt."
      };
    }
    const url = `${BLOGGER_API_BASE}/blogs/${encodeURIComponent(this.blogId)}/posts/${encodeURIComponent(postId)}?view=ADMIN`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "GET",
        headers,
        signal: this.timeoutSignal(BLOGGER_REQUEST_TIMEOUT_MS)
      });
    } catch {
      return {
        ok: false,
        kind: "unknown",
        code: "BLOGGER_READ_TRANSPORT_UNKNOWN",
        detail: "The read attempt ended without a conclusive Blogger response."
      };
    }

    if (!response.ok) return classifyGetHttpFailure(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, kind: "unknown", code: "BLOGGER_RESPONSE_INVALID", detail: "Blogger returned an unreadable post response." };
    }
    const parsed = bloggerPostResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, kind: "unknown", code: "BLOGGER_RESPONSE_INVALID", detail: "Blogger returned an invalid post response." };
    }
    const data = parsed.data;
    const post: RemotePost = { id: data.id };
    if (data.blog?.id !== undefined) post.blogId = data.blog.id;
    if (data.status !== undefined) post.status = data.status;
    if (data.title !== undefined) post.title = data.title;
    if (data.content !== undefined) post.content = data.content;
    if (data.labels !== undefined) post.labels = data.labels;
    if (data.customMetaData !== undefined) post.customMetaData = data.customMetaData;
    return { ok: true, post };
  }
}
