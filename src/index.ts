import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createRuntimeCredentialProvider } from "./auth/oauth-client.js";
import { BloggerRestAdapter } from "./blogger/adapter.js";
import { loadConfig } from "./config.js";
import { createBlogspotMcpServer } from "./server.js";

export async function startServer(): Promise<void> {
  const config = await loadConfig({ mode: "runtime" });
  const credentialProvider = await createRuntimeCredentialProvider(config);
  const adapter = new BloggerRestAdapter(config.blogId, credentialProvider);
  const server = createBlogspotMcpServer({ blogId: config.blogId, adapter });
  await server.connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  try {
    await startServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Startup preflight failed.";
    process.stderr.write(`blogspot-mcp startup failed: ${message}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entrypoint === import.meta.url) await main();
