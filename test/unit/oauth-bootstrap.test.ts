import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Client } from "google-auth-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performOAuthBootstrap } from "../../src/auth/bootstrap.js";
import { loadConfig, type AppConfig } from "../../src/config.js";

describe("OAuth bootstrap", () => {
  let root: string;
  let config: AppConfig;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "blogspot-mcp-oauth-"));
    const repositoryRoot = join(root, "repository");
    const externalRoot = join(root, "external");
    await mkdir(repositoryRoot, { mode: 0o700 });
    await mkdir(externalRoot, { mode: 0o700 });
    const oauthClientFile = join(externalRoot, "client.json");
    const tokenFile = join(externalRoot, "token.json");
    await writeFile(oauthClientFile, JSON.stringify({
      installed: {
        client_id: "test-client-id",
        client_secret: "test-client-secret",
        redirect_uris: ["http://127.0.0.1"]
      }
    }), { mode: 0o600 });
    config = await loadConfig({
      mode: "bootstrap",
      repositoryRoot,
      env: {
        BLOGGER_BLOG_ID: "1234567890123456789",
        BLOGGER_OAUTH_CLIENT_FILE: oauthClientFile,
        BLOGGER_TOKEN_FILE: tokenFile
      }
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("uses loopback state, PKCE S256, offline access, and stores only bounded refresh metadata", async () => {
    let tokenClient: OAuth2Client | undefined;
    const createClient = (clientId: string, clientSecret: string, redirectUri: string): OAuth2Client => {
      tokenClient = new OAuth2Client({ clientId, clientSecret, redirectUri });
      vi.spyOn(tokenClient, "getToken").mockResolvedValue({
        tokens: {
          access_token: "test-only-access-value",
          refresh_token: "test-only-refresh-value",
          scope: "https://www.googleapis.com/auth/blogger",
          token_type: "Bearer"
        },
        res: null
      });
      return tokenClient;
    };

    await performOAuthBootstrap(config, {
      createClient,
      launchBrowser: authorizationUrl => {
        const url = new URL(authorizationUrl);
        expect(url.searchParams.get("access_type")).toBe("offline");
        expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/blogger");
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("code_challenge")).toBeTruthy();
        const state = url.searchParams.get("state");
        const redirectUri = url.searchParams.get("redirect_uri");
        expect(state).toBeTruthy();
        expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/u);
        setTimeout(() => {
          void fetch(`${redirectUri}?code=test-only-code&state=${encodeURIComponent(state ?? "")}`);
        }, 10);
      }
    });

    expect(tokenClient?.getToken).toHaveBeenCalledWith(expect.objectContaining({
      code: "test-only-code",
      codeVerifier: expect.any(String),
      redirect_uri: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/oauth2\/callback$/u)
    }));
    const stored = JSON.parse(await readFile(config.tokenFile, "utf8"));
    expect(stored).toEqual({
      refresh_token: "test-only-refresh-value",
      scope: "https://www.googleapis.com/auth/blogger",
      token_type: "Bearer"
    });
    expect(JSON.stringify(stored)).not.toContain("access_token");
  });
});
