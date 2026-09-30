import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  open,
  readFile,
  rename,
  stat,
  unlink,
  type FileHandle
} from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ProvenanceAccessResult,
  ProvenanceEvidence,
  ProvenanceRecord,
  ProvenanceStore
} from "../domain/contracts.js";
import {
  decodeProvenanceStore,
  emptyProvenanceStore,
  encodeProvenanceStore,
  provenanceKey,
  type ProvenanceStoreDocument
} from "../domain/provenance.js";
import { provenanceFailure } from "./errors.js";

type SidecarStoreDependencies = {
  beforeRename?: (temporaryPath: string) => void | Promise<void>;
  afterRename?: () => void | Promise<void>;
  processIsActive?: (pid: number) => boolean;
  validateTarget?: (allowMissing: boolean) => void | Promise<void>;
};

type LockMetadata = {
  schema_version: 1;
  pid: number;
  created_at: string;
};

function evidenceFor(blogId: string, postId: string, record?: ProvenanceRecord): ProvenanceEvidence {
  const evidence: ProvenanceEvidence = {
    storage: "owner_sidecar",
    key: { blog_id: blogId, post_id: postId }
  };
  if (record !== undefined) evidence.record = record;
  return evidence;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyPresent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function defaultProcessIsActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

export class FileProvenanceStore implements ProvenanceStore {
  private readonly lockPath: string;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly dependencies: SidecarStoreDependencies = {}
  ) {
    this.lockPath = `${filePath}.lock`;
  }

  async persist(record: ProvenanceRecord): Promise<ProvenanceAccessResult> {
    return this.serialize(async () => {
      const evidence = evidenceFor(record.blog_id, record.post_id);
      try {
        await this.dependencies.validateTarget?.(true);
      } catch {
        return provenanceFailure(
          evidence,
          "PROVENANCE_WRITE_FAILED",
          "The provenance target failed safety revalidation before persistence."
        );
      }
      const lock = await this.acquireLock(evidence);
      if (!lock.ok) return lock.result;

      let result: ProvenanceAccessResult | undefined;
      try {
        const loaded = await this.loadStore(true, evidence);
        if (!loaded.ok) {
          result = loaded.result;
        } else {
          const key = provenanceKey(record.blog_id, record.post_id);
          const existing = loaded.store.records[key];
          if (existing !== undefined) {
            result = { ok: true, evidence: evidenceFor(record.blog_id, record.post_id, existing) };
          } else {
            loaded.store.records[key] = record;
            const written = await this.replaceStore(loaded.store, evidence);
            if (!written.ok) {
              result = written;
            } else {
              const committed = await this.loadStore(false, evidence);
              if (!committed.ok) {
                result = provenanceFailure(
                  committed.result.evidence,
                  "PROVENANCE_WRITE_FAILED",
                  "The committed provenance store could not be re-read."
                );
              } else {
                const committedRecord = committed.store.records[key];
                result = committedRecord === undefined
                  ? provenanceFailure(
                      evidence,
                      "PROVENANCE_WRITE_FAILED",
                      "The committed provenance record was absent after replacement."
                    )
                  : { ok: true, evidence: evidenceFor(record.blog_id, record.post_id, committedRecord) };
              }
            }
          }
        }
      } finally {
        const released = await this.releaseLock(lock.handle);
        if (!released && (result === undefined || result.ok)) {
          result = provenanceFailure(
            evidence,
            "PROVENANCE_WRITE_FAILED",
            "The provenance lock could not be released after persistence."
          );
        }
      }
      if (result === undefined) throw new Error("Provenance persistence result invariant failed.");
      return result;
    });
  }

  async lookup(blogId: string, postId: string): Promise<ProvenanceAccessResult> {
    return this.serialize(async () => {
      const evidence = evidenceFor(blogId, postId);
      try {
        await this.dependencies.validateTarget?.(true);
      } catch {
        return provenanceFailure(
          evidence,
          "PROVENANCE_STORE_UNREADABLE",
          "The provenance target failed safety revalidation before lookup."
        );
      }
      const lockFailure = await this.existingLockFailure(evidence);
      if (lockFailure !== undefined) return lockFailure;
      const loaded = await this.loadStore(false, evidence);
      if (!loaded.ok) return loaded.result;
      const record = loaded.store.records[provenanceKey(blogId, postId)];
      if (record === undefined) {
        return provenanceFailure(
          evidence,
          "PROVENANCE_RECORD_ABSENT",
          "No provenance record exists for the configured blog and post ID."
        );
      }
      return { ok: true, evidence: evidenceFor(blogId, postId, record) };
    });
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationTail.then(operation, operation);
    this.operationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  private async acquireLock(evidence: ProvenanceEvidence): Promise<
    | { ok: true; handle: FileHandle }
    | { ok: false; result: ProvenanceAccessResult }
  > {
    let handle: FileHandle;
    try {
      handle = await open(this.lockPath, "wx", 0o600);
    } catch (error) {
      if (isAlreadyPresent(error)) {
        const result = await this.existingLockFailure(evidence);
        return {
          ok: false,
          result: result ?? provenanceFailure(
            evidence,
            "PROVENANCE_LOCK_CONTENDED",
            "The provenance lock appeared during acquisition."
          )
        };
      }
      return {
        ok: false,
        result: provenanceFailure(
          evidence,
          "PROVENANCE_WRITE_FAILED",
          "The provenance lock could not be created."
        )
      };
    }

    const metadata: LockMetadata = {
      schema_version: 1,
      pid: process.pid,
      created_at: new Date().toISOString()
    };
    try {
      await handle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
      await handle.sync();
      return { ok: true, handle };
    } catch {
      await handle.close().catch(() => undefined);
      await unlink(this.lockPath).catch(() => undefined);
      return {
        ok: false,
        result: provenanceFailure(
          evidence,
          "PROVENANCE_WRITE_FAILED",
          "The provenance lock metadata could not be persisted."
        )
      };
    }
  }

  private async existingLockFailure(evidence: ProvenanceEvidence): Promise<ProvenanceAccessResult | undefined> {
    let contents: string;
    try {
      contents = await readFile(this.lockPath, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      return provenanceFailure(
        evidence,
        "PROVENANCE_LOCK_CONTENDED",
        "The provenance lock owner could not be established."
      );
    }

    let pid: number | undefined;
    try {
      const parsed = JSON.parse(contents) as { pid?: unknown };
      if (Number.isSafeInteger(parsed.pid) && Number(parsed.pid) > 0) pid = Number(parsed.pid);
    } catch {
      // Malformed lock metadata is indeterminate contention, never an invitation to steal the lock.
    }
    if (pid === undefined || (this.dependencies.processIsActive ?? defaultProcessIsActive)(pid)) {
      return provenanceFailure(
        evidence,
        "PROVENANCE_LOCK_CONTENDED",
        "The provenance store is locked by an active or indeterminate writer."
      );
    }
    return provenanceFailure(
      evidence,
      "PROVENANCE_STALE_LOCK",
      "The provenance store has a stale lock that requires verified manual recovery."
    );
  }

  private async releaseLock(handle: FileHandle): Promise<boolean> {
    try {
      await handle.close();
      await unlink(this.lockPath);
      return true;
    } catch {
      return false;
    }
  }

  private async loadStore(
    allowMissing: boolean,
    evidence: ProvenanceEvidence
  ): Promise<
    | { ok: true; store: ProvenanceStoreDocument }
    | { ok: false; result: ProvenanceAccessResult }
  > {
    try {
      const info = await lstat(this.filePath);
      if (info.isSymbolicLink() || !info.isFile()) {
        return {
          ok: false,
          result: provenanceFailure(
            evidence,
            "PROVENANCE_STORE_UNREADABLE",
            "The provenance path is not a regular non-symlink file."
          )
        };
      }
      if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
        return {
          ok: false,
          result: provenanceFailure(
            evidence,
            "PROVENANCE_STORE_UNREADABLE",
            "The provenance store is not owned by the current user."
          )
        };
      }
      if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
        return {
          ok: false,
          result: provenanceFailure(
            evidence,
            "PROVENANCE_STORE_UNREADABLE",
            "The provenance store permissions are not owner-only."
          )
        };
      }
      await access(this.filePath, constants.R_OK);
      const decoded = decodeProvenanceStore(await readFile(this.filePath, "utf8"));
      return decoded.ok
        ? { ok: true, store: decoded.store }
        : { ok: false, result: provenanceFailure(evidence, decoded.code, decoded.detail) };
    } catch (error) {
      if (isMissing(error)) {
        return allowMissing
          ? { ok: true, store: emptyProvenanceStore() }
          : {
              ok: false,
              result: provenanceFailure(
                evidence,
                "PROVENANCE_RECORD_ABSENT",
                "The provenance store does not exist."
              )
            };
      }
      return {
        ok: false,
        result: provenanceFailure(
          evidence,
          "PROVENANCE_STORE_UNREADABLE",
          "The provenance store could not be read."
        )
      };
    }
  }

  private async replaceStore(
    store: ProvenanceStoreDocument,
    evidence: ProvenanceEvidence
  ): Promise<ProvenanceAccessResult> {
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    let handle: FileHandle | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(encodeProvenanceStore(store), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.dependencies.beforeRename?.(temporaryPath);
      await rename(temporaryPath, this.filePath);
      await this.dependencies.afterRename?.();
      if (process.platform !== "win32") {
        const directory = await open(dirname(this.filePath), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
      const info = await stat(this.filePath);
      if (process.platform !== "win32" && (info.mode & 0o777) !== 0o600) {
        return provenanceFailure(
          evidence,
          "PROVENANCE_WRITE_FAILED",
          "The committed provenance store permissions are not owner-only."
        );
      }
      return { ok: true, evidence };
    } catch {
      await handle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      return provenanceFailure(
        evidence,
        "PROVENANCE_WRITE_FAILED",
        "The provenance store could not be replaced atomically."
      );
    }
  }
}
