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

export async function writeTokenAtomically(config: AppConfig, token: StoredToken): Promise<void> {
  const validated = storedTokenSchema.parse(token);
  const target = await revalidateTokenTarget(config, true);
  const temporary = join(dirname(target), `.blogger-token-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(validated)}\n`, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await revalidateTokenTarget(config, true);
    await rename(temporary, target);
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
