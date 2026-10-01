import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  createRuntimeCredentialProvider,
  OAuthCredentialError,
  type AuthorizationHeaderProvider
} from "./auth/oauth-client.js";
import { BloggerRestAdapter } from "./blogger/adapter.js";
import {
  ConfigurationError,
  loadConfig,
  revalidateProvenanceTarget,
  type AppConfig
} from "./config.js";
import { FileProvenanceStore } from "./provenance/sidecar-store.js";
import { createBlogspotMcpServer } from "./server.js";

type StartServerDependencies = {
  loadRuntimeConfig?: () => Promise<AppConfig>;
  createCredentialProvider?: (config: AppConfig) => Promise<AuthorizationHeaderProvider>;
  connect?: (server: McpServer) => Promise<void>;
};

export async function startServer(dependencies: StartServerDependencies = {}): Promise<void> {
  const config = await (dependencies.loadRuntimeConfig ?? (() => loadConfig({ mode: "runtime" })))();
  const credentialProvider = await (dependencies.createCredentialProvider ?? createRuntimeCredentialProvider)(config);
  const adapter = new BloggerRestAdapter(config.blogId, credentialProvider);
  const provenanceStore = new FileProvenanceStore(config.provenanceFile, {
    validateTarget: allowMissing => revalidateProvenanceTarget(config, allowMissing)
  });
  const server = createBlogspotMcpServer({ blogId: config.blogId, adapter, provenanceStore });
  await (dependencies.connect ?? (instance => instance.connect(new StdioServerTransport())))(server);
}

export function startupFailureDetail(error: unknown): string {
  if (error instanceof ConfigurationError || error instanceof OAuthCredentialError) return error.message;
  return "Unexpected startup preflight failure.";
}

export async function runEntrypoint(dependencies: {
  start?: () => Promise<void>;
  writeStderr?: (message: string) => void;
} = {}): Promise<number> {
  try {
    await (dependencies.start ?? startServer)();
    return 0;
  } catch (error) {
    const message = `blogspot-mcp startup failed: ${startupFailureDetail(error)}\n`;
    (dependencies.writeStderr ?? (value => process.stderr.write(value)))(message);
    return 1;
  }
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entrypoint === import.meta.url) process.exitCode = await runEntrypoint();
