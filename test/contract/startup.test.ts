import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";
import { runEntrypoint, startServer, startupFailureDetail } from "../../src/index.js";

describe("startup and diagnostics boundary", () => {
  it("fails invalid configuration before credential setup or stdio connection", async () => {
    const createCredentialProvider = vi.fn();
    const connect = vi.fn();

    await expect(startServer({
      loadRuntimeConfig: () => loadConfig({ mode: "runtime", env: {} }),
      createCredentialProvider,
      connect
    })).rejects.toThrow("Invalid BLOGGER_BLOG_ID configuration");

    expect(createCredentialProvider).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("redacts credential-shaped unexpected defects and writes only bounded stderr", async () => {
    const secretMarker = "refresh_token=secret-fixture Authorization: Bearer secret-fixture";
    const stderr: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      const exitCode = await runEntrypoint({
        start: async () => {
          throw new Error(secretMarker);
        },
        writeStderr: message => stderr.push(message)
      });

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([
        "blogspot-mcp startup failed: Unexpected startup preflight failure.\n"
      ]);
      expect(stderr.join("")).not.toContain(secretMarker);
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
    }
  });

  it("preserves only explicitly safe configuration diagnostics", () => {
    expect(startupFailureDetail(new Error("client_secret=secret-fixture"))).toBe(
      "Unexpected startup preflight failure."
    );
  });
});
