import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../../src/config.js";
import { writeTokenAtomically } from "../../src/auth/token-store.js";

describe("configuration and token target safety", () => {
  let root: string;
  let repositoryRoot: string;
  let externalRoot: string;
  let oauthClientFile: string;
  let tokenFile: string;
  let provenanceFile: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "blogspot-mcp-config-"));
    repositoryRoot = join(root, "repository");
    externalRoot = join(root, "external");
    await mkdir(repositoryRoot, { mode: 0o700 });
    await mkdir(externalRoot, { mode: 0o700 });
    oauthClientFile = join(externalRoot, "client.json");
    tokenFile = join(externalRoot, "token.json");
    provenanceFile = join(externalRoot, "provenance.json");
    await writeFile(oauthClientFile, "{}", { mode: 0o600 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const env = (): NodeJS.ProcessEnv => ({
    BLOGGER_BLOG_ID: "1234567890123456789",
    BLOGGER_OAUTH_CLIENT_FILE: oauthClientFile,
    BLOGGER_TOKEN_FILE: tokenFile,
    BLOGGER_PROVENANCE_FILE: provenanceFile
  });

  it("allows a missing token only during bootstrap", async () => {
    const bootstrap = await loadConfig({ mode: "bootstrap", env: env(), repositoryRoot });
    expect(bootstrap.tokenFile).toBe(join(await realpath(externalRoot), "token.json"));
    await expect(loadConfig({ mode: "runtime", env: env(), repositoryRoot })).rejects.toThrow(
      "BLOGGER_TOKEN_FILE must reference an existing regular file"
    );
  });

  it("requires absolute, external, non-symlink owner-only credential files", async () => {
    const inside = join(repositoryRoot, "client.json");
    await writeFile(inside, "{}", { mode: 0o600 });
    await expect(loadConfig({
      mode: "bootstrap",
      env: { ...env(), BLOGGER_OAUTH_CLIENT_FILE: inside },
      repositoryRoot
    })).rejects.toThrow("outside the repository");

    const link = join(externalRoot, "client-link.json");
    await symlink(oauthClientFile, link);
    await expect(loadConfig({
      mode: "bootstrap",
      env: { ...env(), BLOGGER_OAUTH_CLIENT_FILE: link },
      repositoryRoot
    })).rejects.toThrow("non-symlink regular file");

    await chmod(oauthClientFile, 0o644);
    await expect(loadConfig({ mode: "bootstrap", env: env(), repositoryRoot })).rejects.toThrow(
      "owner-only permissions"
    );
  });

  it("accepts an absent safe provenance target but rejects an unsafe existing one", async () => {
    const config = await loadConfig({ mode: "bootstrap", env: env(), repositoryRoot });
    expect(config.provenanceFile).toBe(join(await realpath(externalRoot), "provenance.json"));

    await writeFile(provenanceFile, '{"schema_version":1,"records":{}}', { mode: 0o644 });
    await expect(loadConfig({ mode: "bootstrap", env: env(), repositoryRoot })).rejects.toThrow(
      "BLOGGER_PROVENANCE_FILE must have owner-only permissions"
    );
  });

  it("requires the provenance parent to be owner-controlled", async () => {
    const unsafeParent = join(root, "unsafe-provenance");
    await mkdir(unsafeParent, { mode: 0o700 });
    await chmod(unsafeParent, 0o777);
    await expect(loadConfig({
      mode: "bootstrap",
      env: { ...env(), BLOGGER_PROVENANCE_FILE: join(unsafeParent, "provenance.json") },
      repositoryRoot
    })).rejects.toThrow("BLOGGER_PROVENANCE_FILE parent must not be group/other writable");
  });

  it("revalidates the token target before atomic replacement", async () => {
    const config = await loadConfig({ mode: "bootstrap", env: env(), repositoryRoot });
    await writeFile(tokenFile, "{}", { mode: 0o644 });
    await expect(writeTokenAtomically(config, { refresh_token: "test-only-refresh-value" })).rejects.toThrow(
      "owner-only permissions"
    );
    expect(await readFile(tokenFile, "utf8")).toBe("{}");
  });

  it("fails closed when token target resolution changes immediately before rename", async () => {
    const config = await loadConfig({ mode: "bootstrap", env: env(), repositoryRoot });
    const redirectedTarget = join(externalRoot, "redirected-token.json");
    let validations = 0;

    await expect(writeTokenAtomically(
      config,
      { refresh_token: "test-only-refresh-value" },
      {
        revalidateTarget: async () => {
          validations += 1;
          return validations === 1 ? tokenFile : redirectedTarget;
        }
      }
    )).rejects.toThrow("Token target changed during atomic persistence");

    expect(validations).toBe(2);
    await expect(lstat(tokenFile)).rejects.toThrow();
    await expect(lstat(redirectedTarget)).rejects.toThrow();
    expect((await readdir(externalRoot)).filter(name => name.startsWith(".blogger-token-"))).toEqual([]);
  });

  it("writes a same-directory owner-only token atomically", async () => {
    const config: AppConfig = await loadConfig({ mode: "bootstrap", env: env(), repositoryRoot });
    await writeTokenAtomically(config, {
      refresh_token: "test-only-refresh-value",
      scope: "test-scope",
      token_type: "Bearer"
    });
    const info = await lstat(tokenFile);
    expect(info.isFile()).toBe(true);
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(tokenFile, "utf8"))).toEqual({
      refresh_token: "test-only-refresh-value",
      scope: "test-scope",
      token_type: "Bearer"
    });
  });
});
