import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthorizationUrlFile } from "../../src/auth/authorization-url-file.js";

describe("temporary authorization URL file", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  });

  it("writes exact content owner-only and removes it after callback handling", async () => {
    root = await mkdtemp(join(tmpdir(), "blogspot-mcp-auth-url-"));
    const path = join(root, "nested", "oauth-authorization-url.txt");
    const file = createAuthorizationUrlFile(path);
    const url = "https://accounts.example.test/authorize?state=test-only-state";

    await file.write(url);
    expect(await readFile(path, "utf8")).toBe(`${url}\n`);
    const info = await lstat(path);
    expect(info.isFile()).toBe(true);
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);

    await file.remove();
    await expect(lstat(path)).rejects.toThrow();
  });
});
