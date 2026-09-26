import { constants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type ConfigMode = "bootstrap" | "runtime";

export type AppConfig = {
  blogId: string;
  oauthClientFile: string;
  tokenFile: string;
  repositoryRoot: string;
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const environmentSchema = z.object({
  BLOGGER_BLOG_ID: z.string().regex(/^\d+$/u, "must be a non-empty decimal Blogger blog ID"),
  BLOGGER_OAUTH_CLIENT_FILE: z.string().min(1),
  BLOGGER_TOKEN_FILE: z.string().min(1)
});

export function defaultRepositoryRoot(): string {
  return fileURLToPath(new URL("..", import.meta.url));
}

function outsideRepository(repositoryRoot: string, candidate: string): boolean {
  const pathFromRoot = relative(repositoryRoot, candidate);
  return pathFromRoot !== "" && pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot);
}

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

async function requireSafeExternalFile(
  variableName: string,
  rawPath: string,
  repositoryRoot: string
): Promise<string> {
  if (!isAbsolute(rawPath)) {
    throw new ConfigurationError(`${variableName} must be an absolute path.`);
  }
  let linkInfo;
  try {
    linkInfo = await lstat(rawPath);
  } catch {
    throw new ConfigurationError(`${variableName} must reference an existing regular file.`);
  }
  if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) {
    throw new ConfigurationError(`${variableName} must reference a non-symlink regular file.`);
  }
  const resolvedPath = await realpath(rawPath);
  if (!outsideRepository(repositoryRoot, resolvedPath)) {
    throw new ConfigurationError(`${variableName} must resolve outside the repository.`);
  }
  const fileInfo = await stat(resolvedPath);
  const uid = currentUid();
  if (uid !== undefined && fileInfo.uid !== uid) {
    throw new ConfigurationError(`${variableName} must be owned by the current user.`);
  }
  if (process.platform !== "win32" && (fileInfo.mode & 0o077) !== 0) {
    throw new ConfigurationError(`${variableName} must have owner-only permissions.`);
  }
  await access(resolvedPath, constants.R_OK);
  return resolvedPath;
}

async function requireSafeExternalTokenTarget(
  rawPath: string,
  repositoryRoot: string,
  allowMissing: boolean
): Promise<string> {
  if (!isAbsolute(rawPath)) {
    throw new ConfigurationError("BLOGGER_TOKEN_FILE must be an absolute path.");
  }
  try {
    return await requireSafeExternalFile("BLOGGER_TOKEN_FILE", rawPath, repositoryRoot);
  } catch (error) {
    let exists = true;
    try {
      await lstat(rawPath);
    } catch {
      exists = false;
    }
    if (exists || !allowMissing) throw error;
  }

  const rawParent = dirname(rawPath);
  let resolvedParent: string;
  try {
    resolvedParent = await realpath(rawParent);
  } catch {
    throw new ConfigurationError("BLOGGER_TOKEN_FILE parent directory must exist.");
  }
  if (!outsideRepository(repositoryRoot, resolvedParent)) {
    throw new ConfigurationError("BLOGGER_TOKEN_FILE must resolve outside the repository.");
  }
  const parentInfo = await stat(resolvedParent);
  if (!parentInfo.isDirectory()) {
    throw new ConfigurationError("BLOGGER_TOKEN_FILE parent must be a directory.");
  }
  const uid = currentUid();
  if (uid !== undefined && parentInfo.uid !== uid) {
    throw new ConfigurationError("BLOGGER_TOKEN_FILE parent must be owned by the current user.");
  }
  if (process.platform !== "win32" && (parentInfo.mode & 0o022) !== 0) {
    throw new ConfigurationError("BLOGGER_TOKEN_FILE parent must not be group/other writable.");
  }
  await access(resolvedParent, constants.R_OK | constants.W_OK | constants.X_OK);
  return resolve(resolvedParent, rawPath.slice(rawParent.length + 1));
}

export async function loadConfig(options: {
  mode: ConfigMode;
  env?: NodeJS.ProcessEnv;
  repositoryRoot?: string;
}): Promise<AppConfig> {
  const env = environmentSchema.safeParse(options.env ?? process.env);
  if (!env.success) {
    const variable = env.error.issues[0]?.path[0] ?? "environment";
    throw new ConfigurationError(`Invalid ${String(variable)} configuration.`);
  }
  const repositoryRoot = await realpath(options.repositoryRoot ?? defaultRepositoryRoot());
  const oauthClientFile = await requireSafeExternalFile(
    "BLOGGER_OAUTH_CLIENT_FILE",
    env.data.BLOGGER_OAUTH_CLIENT_FILE,
    repositoryRoot
  );
  const tokenFile = await requireSafeExternalTokenTarget(
    env.data.BLOGGER_TOKEN_FILE,
    repositoryRoot,
    options.mode === "bootstrap"
  );
  return {
    blogId: env.data.BLOGGER_BLOG_ID,
    oauthClientFile,
    tokenFile,
    repositoryRoot
  };
}

export async function revalidateTokenTarget(config: AppConfig, allowMissing: boolean): Promise<string> {
  return requireSafeExternalTokenTarget(config.tokenFile, config.repositoryRoot, allowMissing);
}
