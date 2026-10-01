import { chmod, lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProvenanceRecord } from "../../src/domain/provenance.js";
import { FileProvenanceStore } from "../../src/provenance/sidecar-store.js";

describe("owner-controlled provenance sidecar", () => {
  let root: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "blogspot-mcp-provenance-"));
    await chmod(root, 0o700);
    file = join(root, "provenance.json");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("maps an absent store or key to PROVENANCE_RECORD_ABSENT", async () => {
    const store = new FileProvenanceStore(file);
    await expect(store.lookup("123", "456")).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_RECORD_ABSENT"
    });
  });

  it("persists both schema versions owner-only and re-reads the committed record", async () => {
    const store = new FileProvenanceStore(file);
    const record = createProvenanceRecord("123", "456", "artifact", "version");

    await expect(store.persist(record)).resolves.toMatchObject({ ok: true, evidence: { record } });
    await expect(store.lookup("123", "456")).resolves.toMatchObject({ ok: true, evidence: { record } });
    const serialized = JSON.parse(await readFile(file, "utf8"));
    expect(serialized.schema_version).toBe(1);
    expect(serialized.records["123:456"].schema_version).toBe(1);
    expect(JSON.stringify(serialized)).not.toMatch(/authorization|token|title|body|labels/iu);
    const info = await lstat(file);
    if (process.platform !== "win32") expect(info.mode & 0o777).toBe(0o600);
    expect(await readdir(root)).toEqual(["provenance.json"]);
  });

  it("never overwrites an existing valid key with different source identifiers", async () => {
    const store = new FileProvenanceStore(file);
    const first = createProvenanceRecord("123", "456", "first", "v1");
    const conflicting = createProvenanceRecord("123", "456", "second", "v2");

    await store.persist(first);
    await expect(store.persist(conflicting)).resolves.toMatchObject({
      ok: true,
      evidence: { record: first }
    });
    await expect(store.lookup("123", "456")).resolves.toMatchObject({
      ok: true,
      evidence: { record: first }
    });
  });

  it.each([
    ["not-json", "PROVENANCE_STORE_CORRUPT"],
    ['{"schema_version":2,"records":{}}', "PROVENANCE_SCHEMA_UNSUPPORTED"],
    ['{"schema_version":1,"records":{"123:456":{"schema_version":2,"blog_id":"123","post_id":"456","artifact_id":"a","version_id":"v"}}}', "PROVENANCE_SCHEMA_UNSUPPORTED"],
    ['{"schema_version":1,"records":{"123:456":{"schema_version":1,"blog_id":"123","post_id":"999","artifact_id":"a","version_id":"v"}}}', "PROVENANCE_KEY_INTEGRITY_CONFLICT"]
  ])("maps invalid persisted state to %s", async (contents, code) => {
    await writeFile(file, contents, { mode: 0o600 });
    const store = new FileProvenanceStore(file);
    await expect(store.lookup("123", "456")).resolves.toMatchObject({ ok: false, code });
  });

  it("maps unsafe existing permissions to PROVENANCE_STORE_UNREADABLE", async () => {
    await writeFile(file, '{"schema_version":1,"records":{}}', { mode: 0o600 });
    await chmod(file, 0o644);
    const store = new FileProvenanceStore(file);
    await expect(store.lookup("123", "456")).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_STORE_UNREADABLE"
    });
  });

  it("fails closed on active and stale locks without stealing either lock", async () => {
    const lock = `${file}.lock`;
    await writeFile(lock, JSON.stringify({ schema_version: 1, pid: process.pid, created_at: new Date().toISOString() }), { mode: 0o600 });
    const activeStore = new FileProvenanceStore(file);
    await expect(activeStore.lookup("123", "456")).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_LOCK_CONTENDED"
    });
    expect((await lstat(lock)).isFile()).toBe(true);

    await writeFile(lock, JSON.stringify({ schema_version: 1, pid: 999999, created_at: new Date(0).toISOString() }), { mode: 0o600 });
    const staleStore = new FileProvenanceStore(file, { processIsActive: () => false });
    await expect(staleStore.persist(createProvenanceRecord("123", "456", "a", "v"))).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_STALE_LOCK"
    });
    expect((await lstat(lock)).isFile()).toBe(true);
  });

  it("preserves the prior complete file when failure occurs before rename", async () => {
    const baseline = new FileProvenanceStore(file);
    await baseline.persist(createProvenanceRecord("123", "456", "a", "v1"));
    const before = await readFile(file, "utf8");
    const failing = new FileProvenanceStore(file, {
      beforeRename: () => {
        throw new Error("simulated pre-rename crash boundary");
      }
    });

    await expect(failing.persist(createProvenanceRecord("123", "789", "b", "v2"))).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_WRITE_FAILED"
    });
    expect(await readFile(file, "utf8")).toBe(before);
    expect((await readdir(root)).filter(name => name.includes(".tmp-"))).toHaveLength(0);
  });

  it("leaves the new complete file readable when failure occurs after rename", async () => {
    const baseline = new FileProvenanceStore(file);
    await baseline.persist(createProvenanceRecord("123", "456", "a", "v1"));
    const afterRenameFailure = new FileProvenanceStore(file, {
      afterRename: () => {
        throw new Error("simulated post-rename crash boundary");
      }
    });
    const second = createProvenanceRecord("123", "789", "b", "v2");

    await expect(afterRenameFailure.persist(second)).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_WRITE_FAILED"
    });
    const recovered = new FileProvenanceStore(file);
    await expect(recovered.lookup("123", "456")).resolves.toMatchObject({ ok: true });
    await expect(recovered.lookup("123", "789")).resolves.toMatchObject({
      ok: true,
      evidence: { record: second }
    });
  });

  it("serializes concurrent in-process writers without losing either record", async () => {
    const store = new FileProvenanceStore(file);
    const first = createProvenanceRecord("123", "456", "a", "v1");
    const second = createProvenanceRecord("123", "789", "b", "v2");
    await Promise.all([store.persist(first), store.persist(second)]);

    await expect(store.lookup("123", "456")).resolves.toMatchObject({ ok: true, evidence: { record: first } });
    await expect(store.lookup("123", "789")).resolves.toMatchObject({ ok: true, evidence: { record: second } });
  });

  it("maps target revalidation failure without touching the filesystem", async () => {
    const store = new FileProvenanceStore(file, {
      validateTarget: () => {
        throw new Error("simulated path race");
      }
    });
    await expect(store.persist(createProvenanceRecord("123", "456", "a", "v"))).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_WRITE_FAILED"
    });
    await expect(lstat(file)).rejects.toThrow();
  });

  it("fails closed when provenance target resolution changes immediately before rename", async () => {
    const redirectedTarget = join(root, "redirected-provenance.json");
    let validations = 0;
    const store = new FileProvenanceStore(file, {
      validateTarget: () => {
        validations += 1;
        return validations === 1 ? file : redirectedTarget;
      }
    });

    await expect(store.persist(createProvenanceRecord("123", "456", "a", "v"))).resolves.toMatchObject({
      ok: false,
      code: "PROVENANCE_WRITE_FAILED"
    });
    expect(validations).toBe(2);
    await expect(lstat(file)).rejects.toThrow();
    await expect(lstat(redirectedTarget)).rejects.toThrow();
    expect((await readdir(root)).filter(name => name.includes(".tmp-"))).toHaveLength(0);
  });
});
