import { readFile } from "node:fs/promises";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { storedTokenSchema } from "./token-store.js";

export const BLOGGER_SCOPE = "https://www.googleapis.com/auth/blogger";

const desktopClientSchema = z.object({
  installed: z.object({
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    auth_uri: z.string().url().optional(),
    token_uri: z.string().url().optional(),
    redirect_uris: z.array(z.string()).optional()
  }).passthrough()
}).passthrough();

export type DesktopClient = z.infer<typeof desktopClientSchema>["installed"];

export interface AuthorizationHeaderProvider {
  getAuthorizationHeaders(): Promise<Headers>;
}

export class OAuthCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthCredentialError";
  }
}

async function readJson(path: string): Promise<unknown> {
  let value: string;
  try {
    value = await readFile(path, "utf8");
  } catch {
    throw new OAuthCredentialError("OAuth credential file could not be read.");
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new OAuthCredentialError("OAuth credential file contains invalid JSON.");
  }
}

export async function loadDesktopClient(config: AppConfig): Promise<DesktopClient> {
  const result = desktopClientSchema.safeParse(await readJson(config.oauthClientFile));
  if (!result.success) throw new OAuthCredentialError("OAuth client file does not contain a valid Desktop client.");
  return result.data.installed;
}

export function createOAuth2Client(client: DesktopClient, redirectUri?: string): OAuth2Client {
  const options = {
    clientId: client.client_id,
    clientSecret: client.client_secret
  };
  return new OAuth2Client(redirectUri === undefined ? options : { ...options, redirectUri });
}

export async function createRuntimeCredentialProvider(config: AppConfig): Promise<AuthorizationHeaderProvider> {
  const clientData = await loadDesktopClient(config);
  const tokenResult = storedTokenSchema.safeParse(await readJson(config.tokenFile));
  if (!tokenResult.success) throw new OAuthCredentialError("Token file does not contain a valid refresh credential.");
  const oauthClient = createOAuth2Client(clientData);
  oauthClient.setCredentials({ refresh_token: tokenResult.data.refresh_token });

  const provider: AuthorizationHeaderProvider = {
    async getAuthorizationHeaders(): Promise<Headers> {
      return oauthClient.getRequestHeaders();
    }
  };

  try {
    await provider.getAuthorizationHeaders();
  } catch {
    throw new OAuthCredentialError("OAuth access-token readiness check failed.");
  }
  return provider;
}
