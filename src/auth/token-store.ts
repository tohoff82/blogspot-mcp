import { open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { revalidateTokenTarget } from "../config.js";

export const storedTokenSchema = z.object({
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
  token_type: z.string().optional()
}).strict();

export type StoredToken = z.infer<typeof storedTokenSchema>;

type TokenStoreDependencies = {
  revalidateTarget?: typeof revalidateTokenTarget;
  beforeRename?: (temporaryPath: string) => void | Promise<void>;
};

export async function writeTokenAtomically(
  config: AppConfig,
  token: StoredToken,
  dependencies: TokenStoreDependencies = {}
): Promise<void> {
  const validated = storedTokenSchema.parse(token);
  const revalidateTarget = dependencies.revalidateTarget ?? revalidateTokenTarget;
  const target = await revalidateTarget(config, true);
  const temporary = join(dirname(target), `.blogger-token-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(validated)}\n`, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await dependencies.beforeRename?.(temporary);
    const replacementTarget = await revalidateTarget(config, true);
    if (replacementTarget !== target) throw new Error("Token target changed during atomic persistence.");
    await rename(temporary, replacementTarget);
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
