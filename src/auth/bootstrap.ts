import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { CodeChallengeMethod, type OAuth2Client } from "google-auth-library";
import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import { BLOGGER_SCOPE, createOAuth2Client, loadDesktopClient } from "./oauth-client.js";
import { openBrowser } from "./open-browser.js";
import { writeTokenAtomically, type StoredToken } from "./token-store.js";

const CALLBACK_PATH = "/oauth2/callback";
const AUTH_TIMEOUT_MS = 300_000;

function stateMatches(expected: string, received: string | null): boolean {
  if (received === null) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

async function listenLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Loopback listener did not expose a TCP port.");
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

async function awaitAuthorizationCode(server: Server, expectedState: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("OAuth authorization timed out.")), AUTH_TIMEOUT_MS);
    timeout.unref();

    server.on("request", (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("content-type", "text/plain; charset=utf-8");
      if (url.pathname !== CALLBACK_PATH) {
        response.statusCode = 404;
        response.end("Not found.");
        return;
      }
      if (!stateMatches(expectedState, url.searchParams.get("state"))) {
        clearTimeout(timeout);
        response.statusCode = 400;
        response.end("Authorization could not be accepted.");
        reject(new Error("OAuth callback state validation failed."));
        return;
      }
      const code = url.searchParams.get("code");
      if (code === null || code.length === 0) {
        clearTimeout(timeout);
        response.statusCode = 400;
        response.end("Authorization could not be accepted.");
        reject(new Error("OAuth callback did not contain an authorization code."));
        return;
      }
      clearTimeout(timeout);
      response.statusCode = 200;
      response.end("Blogger authorization received. You may close this window.");
      resolve(code);
    });
  });
}

export async function performOAuthBootstrap(
  config: AppConfig,
  dependencies: {
    launchBrowser?: (url: string) => void | Promise<void>;
    createClient?: (clientId: string, clientSecret: string, redirectUri: string) => OAuth2Client;
  } = {}
): Promise<void> {
  const desktopClient = await loadDesktopClient(config);
  const server = createServer();
  try {
    const port = await listenLoopback(server);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const oauthClient = dependencies.createClient?.(
      desktopClient.client_id,
      desktopClient.client_secret,
      redirectUri
    ) ?? createOAuth2Client(desktopClient, redirectUri);
    const state = randomBytes(32).toString("base64url");
    const pkce = await oauthClient.generateCodeVerifierAsync();
    if (pkce.codeChallenge === undefined) throw new Error("PKCE challenge generation failed.");
    const authorizationUrl = oauthClient.generateAuthUrl({
      access_type: "offline",
      scope: [BLOGGER_SCOPE],
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256
    });
    await (dependencies.launchBrowser ?? openBrowser)(authorizationUrl);
    const code = await awaitAuthorizationCode(server, state);
    const tokenResponse = await oauthClient.getToken({ code, codeVerifier: pkce.codeVerifier, redirect_uri: redirectUri });
    const refreshToken = tokenResponse.tokens.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      throw new Error("Google did not return a refresh token; the existing token file was not changed.");
    }
    const stored: StoredToken = { refresh_token: refreshToken };
    if (typeof tokenResponse.tokens.scope === "string") stored.scope = tokenResponse.tokens.scope;
    if (typeof tokenResponse.tokens.token_type === "string") stored.token_type = tokenResponse.tokens.token_type;
    await writeTokenAtomically(config, stored);
  } finally {
    if (server.listening) await closeServer(server);
  }
}

async function main(): Promise<void> {
  try {
    const config = await loadConfig({ mode: "bootstrap" });
    await performOAuthBootstrap(config);
    process.stderr.write("Blogger OAuth credential stored successfully.\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth bootstrap failed.";
    process.stderr.write(`Blogger OAuth bootstrap failed: ${message}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entrypoint === import.meta.url) await main();
