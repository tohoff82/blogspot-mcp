import type {
  BloggerAdapter,
  GetPostResult,
  InsertDraftRequest,
  InsertDraftResult,
  RemotePost
} from "../../src/domain/contracts.js";
import { encodeBody } from "../../src/domain/body-codec.js";
import { encodeProvenance } from "../../src/domain/provenance.js";

export const BLOG_ID = "1234567890123456789";

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
    id: "9876543210",
    blogId: BLOG_ID,
    status: "DRAFT",
    title: VALID_PROJECTION.title,
    content: encodeBody(VALID_PROJECTION.body),
    labels: [...VALID_PROJECTION.labels],
    customMetaData: encodeProvenance(
      VALID_PROJECTION.source.artifact_id,
      VALID_PROJECTION.source.version_id
    ),
    ...overrides
  };
}

export class FakeAdapter implements BloggerAdapter {
  readonly inserts: InsertDraftRequest[] = [];
  readonly gets: string[] = [];

  constructor(
    private readonly insertResult: InsertDraftResult = { ok: true, postId: "9876543210" },
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
