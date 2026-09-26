import { describe, expect, it, vi } from "vitest";
import type { AuthorizationHeaderProvider } from "../../src/auth/oauth-client.js";
import { BLOGGER_REQUEST_TIMEOUT_MS, BloggerRestAdapter } from "../../src/blogger/adapter.js";
import type { InsertDraftRequest } from "../../src/domain/contracts.js";
import { BLOG_ID, matchingPost } from "../helpers/fake-adapter.js";

const REQUEST: InsertDraftRequest = {
  title: "title",
  content: "<p>body</p>",
  labels: ["one"],
  customMetaData: '{"schema_version":1,"artifact_id":"a","version_id":"v"}'
};

const provider = (): AuthorizationHeaderProvider => ({
  async getAuthorizationHeaders(): Promise<Headers> {
    return new Headers({ authorization: "Bearer test-only-access-value" });
  }
});

const jsonResponse = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" }
});

describe("narrow Blogger REST adapter", () => {
  it("constructs only the fixed draft insert request and fresh 15-second signal", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ id: "9876543210" }));
    const signal = new AbortController().signal;
    const timeoutSignal = vi.fn(() => signal);
    const adapter = new BloggerRestAdapter(BLOG_ID, provider(), { fetchFn, timeoutSignal });

    await expect(adapter.insertDraft(REQUEST)).resolves.toEqual({ ok: true, postId: "9876543210" });
    expect(timeoutSignal).toHaveBeenCalledOnce();
    expect(timeoutSignal).toHaveBeenCalledWith(BLOGGER_REQUEST_TIMEOUT_MS);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts?isDraft=true`);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBe(signal);
    expect(JSON.parse(String(init?.body))).toEqual(REQUEST);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-only-access-value");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("acquires authorization before crossing the insert attempt boundary", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const failingProvider: AuthorizationHeaderProvider = {
      async getAuthorizationHeaders(): Promise<Headers> {
        throw new Error("fixture credential failure");
      }
    };
    const adapter = new BloggerRestAdapter(BLOG_ID, failingProvider, { fetchFn });
    await expect(adapter.insertDraft(REQUEST)).resolves.toMatchObject({
      ok: false,
      kind: "auth",
      code: "AUTHORIZATION_HEADER_FAILED"
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([408, 429, 500, 503])("maps inconclusive POST HTTP %s to unknown effect", async status => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
    const adapter = new BloggerRestAdapter(BLOG_ID, provider(), { fetchFn });
    await expect(adapter.insertDraft(REQUEST)).resolves.toMatchObject({ ok: false, kind: "unknown" });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 403, 404])("maps definitive POST HTTP %s to retry-safe rejection evidence", async status => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
    const adapter = new BloggerRestAdapter(BLOG_ID, provider(), { fetchFn });
    await expect(adapter.insertDraft(REQUEST)).resolves.toMatchObject({ ok: false, kind: "definitive" });
  });

  it("maps a transport/timeout rejection after fetch begins to unknown effect without retry", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const adapter = new BloggerRestAdapter(BLOG_ID, provider(), { fetchFn });
    await expect(adapter.insertDraft(REQUEST)).resolves.toMatchObject({
      ok: false,
      kind: "unknown",
      code: "BLOGGER_INSERT_TRANSPORT_UNKNOWN"
    });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("constructs only the fixed admin read-back request and narrows the response", async () => {
    const post = matchingPost();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      id: post.id,
      blog: { id: post.blogId },
      status: post.status,
      title: post.title,
      content: post.content,
      labels: post.labels,
      customMetaData: post.customMetaData,
      ignored_remote_field: "not copied"
    }));
    const signal = new AbortController().signal;
    const timeoutSignal = vi.fn(() => signal);
    const adapter = new BloggerRestAdapter(BLOG_ID, provider(), { fetchFn, timeoutSignal });
    await expect(adapter.getPostAdmin("9876543210")).resolves.toEqual({ ok: true, post });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`https://www.googleapis.com/blogger/v3/blogs/${BLOG_ID}/posts/9876543210?view=ADMIN`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBe(signal);
  });

  it.each([
    [404, "absent"],
    [401, "access_denied"],
    [403, "access_denied"],
    [408, "unknown"],
    [429, "unknown"],
    [500, "unknown"]
  ] as const)("maps GET HTTP %s to %s", async (status, kind) => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
    const adapter = new BloggerRestAdapter(BLOG_ID, provider(), { fetchFn });
    await expect(adapter.getPostAdmin("9876543210")).resolves.toMatchObject({ ok: false, kind });
  });

  it("creates a distinct fixed timeout signal for each request", async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: "9876543210" }))
      .mockResolvedValueOnce(jsonResponse({ id: "9876543210" }));
    const timeoutSignal = vi.fn(() => new AbortController().signal);
    const adapter = new BloggerRestAdapter(BLOG_ID, provider(), { fetchFn, timeoutSignal });
    await adapter.insertDraft(REQUEST);
    await adapter.getPostAdmin("9876543210");
    expect(timeoutSignal).toHaveBeenCalledTimes(2);
    expect(timeoutSignal.mock.results[0]?.value).not.toBe(timeoutSignal.mock.results[1]?.value);
  });
});
