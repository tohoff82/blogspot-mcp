import type {
  BloggerAdapter,
  GetPostResult,
  InsertDraftRequest,
  InsertDraftResult,
  ProvenanceAccessResult,
  ProvenanceRecord,
  ProvenanceStore,
  RemotePost
} from "../../src/domain/contracts.js";
import { encodeBody } from "../../src/domain/body-codec.js";
import { createProvenanceRecord, provenanceKey } from "../../src/domain/provenance.js";

export const BLOG_ID = "1234567890123456789";
export const POST_ID = "9876543210";

export const VALID_PROJECTION = {
  title: "Verified title",
  body: "First & second\ncontinued\n\nNext <paragraph>",
  labels: ["evidence", "draft-only"],
  source: {
    artifact_id: "artifact-123",
    version_id: "version-7"
  }
};

export function matchingPost(overrides: Partial<RemotePost> = {}): RemotePost {
  return {
    id: POST_ID,
    blogId: BLOG_ID,
    status: "DRAFT",
    title: VALID_PROJECTION.title,
    content: encodeBody(VALID_PROJECTION.body),
    labels: [...VALID_PROJECTION.labels],
    ...overrides
  };
}

export class FakeAdapter implements BloggerAdapter {
  readonly inserts: InsertDraftRequest[] = [];
  readonly gets: string[] = [];

  constructor(
    private readonly insertResult: InsertDraftResult = { ok: true, postId: POST_ID },
    private readonly getResult: GetPostResult = { ok: true, post: matchingPost() }
  ) {}

  async insertDraft(request: InsertDraftRequest): Promise<InsertDraftResult> {
    this.inserts.push(request);
    return this.insertResult;
  }

  async getPostAdmin(postId: string): Promise<GetPostResult> {
    this.gets.push(postId);
    return this.getResult;
  }
}

export function matchingProvenanceRecord(overrides: Partial<ProvenanceRecord> = {}): ProvenanceRecord {
  return {
    ...createProvenanceRecord(
      BLOG_ID,
      POST_ID,
      VALID_PROJECTION.source.artifact_id,
      VALID_PROJECTION.source.version_id
    ),
    ...overrides
  };
}

export class FakeProvenanceStore implements ProvenanceStore {
  readonly persists: ProvenanceRecord[] = [];
  readonly lookups: Array<{ blogId: string; postId: string }> = [];
  readonly records = new Map<string, ProvenanceRecord>();

  constructor(
    private readonly persistOverride?: ProvenanceAccessResult,
    private readonly lookupOverride?: ProvenanceAccessResult
  ) {}

  async persist(record: ProvenanceRecord): Promise<ProvenanceAccessResult> {
    this.persists.push(record);
    if (this.persistOverride !== undefined) return this.persistOverride;
    const key = provenanceKey(record.blog_id, record.post_id);
    const existing = this.records.get(key);
    if (existing === undefined) this.records.set(key, record);
    const observed = existing ?? record;
    return {
      ok: true,
      evidence: {
        storage: "owner_sidecar",
        key: { blog_id: record.blog_id, post_id: record.post_id },
        record: observed
      }
    };
  }

  async lookup(blogId: string, postId: string): Promise<ProvenanceAccessResult> {
    this.lookups.push({ blogId, postId });
    if (this.lookupOverride !== undefined) return this.lookupOverride;
    const record = this.records.get(provenanceKey(blogId, postId)) ?? matchingProvenanceRecord({ blog_id: blogId, post_id: postId });
    return {
      ok: true,
      evidence: {
        storage: "owner_sidecar",
        key: { blog_id: blogId, post_id: postId },
        record
      }
    };
  }
}
