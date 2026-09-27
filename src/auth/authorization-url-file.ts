import { randomUUID } from "node:crypto";
import { open, chmod, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const AUTHORIZATION_URL_FILE = join(
  homedir(),
  ".config",
  "blogspot-mcp",
  "oauth-authorization-url.txt"
);

export interface AuthorizationUrlFile {
  write(url: string): Promise<void>;
  remove(): Promise<void>;
}

export function createAuthorizationUrlFile(path = AUTHORIZATION_URL_FILE): AuthorizationUrlFile {
  return {
    async write(url: string): Promise<void> {
      const directory = dirname(path);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await chmod(directory, 0o700);
      const temporary = join(directory, `.oauth-authorization-url-${process.pid}-${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(`${url}\n`, { encoding: "utf8" });
        await handle.sync();
        await handle.close();
        handle = undefined;
        if (process.platform !== "win32") await chmod(temporary, 0o600);
        await rename(temporary, path);
        if (process.platform !== "win32") await chmod(path, 0o600);
      } catch (error) {
        if (handle !== undefined) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async remove(): Promise<void> {
      await rm(path, { force: true });
    }
  };
}
