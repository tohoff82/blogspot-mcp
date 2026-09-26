import { z } from "zod";

export const authoredProjectionSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).optional(),
  source: z.object({
    artifact_id: z.string(),
    version_id: z.string()
  }).strict()
}).strict();

export type AuthoredProjection = z.infer<typeof authoredProjectionSchema>;

export const createDraftIngressSchema = z.object({
  title: z.unknown().optional(),
  body: z.unknown().optional(),
  labels: z.unknown().optional(),
  source: z.unknown().optional()
}).catchall(z.unknown());

export const inspectDraftIngressSchema = z.object({
  post_id: z.unknown().optional(),
  expected: z.unknown().optional()
}).catchall(z.unknown());

export type CreateDraftIngress = z.infer<typeof createDraftIngressSchema>;
export type InspectDraftIngress = z.infer<typeof inspectDraftIngressSchema>;

export const validationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string()
}).strict();

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const provenanceSchema = z.object({
  schema_version: z.literal(1),
  artifact_id: z.string(),
  version_id: z.string()
}).strict();

export type Provenance = z.infer<typeof provenanceSchema>;

export const checkNameSchema = z.enum([
  "target",
  "status",
  "title",
  "body",
  "labels",
  "provenance"
]);

export type CheckName = z.infer<typeof checkNameSchema>;

export const verificationCheckSchema = z.object({
  name: checkNameSchema,
  result: z.enum(["MATCH", "MISMATCH", "UNKNOWN"]),
  expected: z.unknown(),
  observed: z.unknown().optional(),
  detail: z.string().optional()
}).strict();

export type VerificationCheck = z.infer<typeof verificationCheckSchema>;

export const remotePostEvidenceSchema = z.object({
  post_id: z.string(),
  blog_id: z.string().optional(),
  status: z.string().optional(),
  title: z.string().optional(),
  canonical_body: z.string().optional(),
  labels: z.array(z.string()).optional(),
  provenance: provenanceSchema.optional()
}).strict();

export type RemotePostEvidence = z.infer<typeof remotePostEvidenceSchema>;

const targetSchema = z.object({ blog_id: z.string() }).strict();
const createErrorSchema = z.object({
  code: z.string(),
  phase: z.enum(["auth", "create", "read_back", "verification"]),
  detail: z.string()
}).strict();
const inspectErrorSchema = z.object({
  code: z.string(),
  phase: z.enum(["auth", "read", "verification"]),
  detail: z.string()
}).strict();

export const validationFailedCreateResultSchema = z.object({
  action: z.literal("create_draft"),
  outcome: z.literal("VALIDATION_FAILED"),
  message: z.string(),
  target: targetSchema,
  requested_raw: z.unknown().optional(),
  issues: z.array(validationIssueSchema),
  remote_effect: z.literal("none"),
  retry_safe: z.literal(true),
  error: z.object({
    code: z.literal("INPUT_VALIDATION_FAILED"),
    phase: z.literal("validation"),
    detail: z.string()
  }).strict()
}).strict();

export const validatedCreateResultSchema = z.object({
  action: z.literal("create_draft"),
  outcome: z.enum([
    "VERIFIED",
    "CREATE_FAILED",
    "CREATED_UNVERIFIED",
    "MISMATCH",
    "REMOTE_EFFECT_UNKNOWN"
  ]),
  message: z.string(),
  target: targetSchema,
  requested: authoredProjectionSchema,
  remote_effect: z.enum(["none", "created", "unknown"]),
  retry_safe: z.boolean(),
  remote: remotePostEvidenceSchema.optional(),
  checks: z.array(verificationCheckSchema).optional(),
  error: createErrorSchema.optional()
}).strict();

export const createDraftResultSchema = z.discriminatedUnion("outcome", [
  validationFailedCreateResultSchema,
  validatedCreateResultSchema
]);

export type CreateDraftResult = z.infer<typeof createDraftResultSchema>;

export const validationFailedInspectResultSchema = z.object({
  action: z.literal("inspect_draft"),
  outcome: z.literal("VALIDATION_FAILED"),
  message: z.string(),
  target: z.object({
    blog_id: z.string(),
    post_id: z.string().optional()
  }).strict(),
  requested_raw: z.unknown().optional(),
  issues: z.array(validationIssueSchema),
  error: z.object({
    code: z.literal("INPUT_VALIDATION_FAILED"),
    phase: z.literal("validation"),
    detail: z.string()
  }).strict()
}).strict();

export const validatedInspectResultSchema = z.object({
  action: z.literal("inspect_draft"),
  outcome: z.enum(["VERIFIED", "MISMATCH", "ABSENT", "ACCESS_DENIED", "REMOTE_UNKNOWN"]),
  message: z.string(),
  target: z.object({ blog_id: z.string(), post_id: z.string() }).strict(),
  expected: authoredProjectionSchema,
  remote: remotePostEvidenceSchema.optional(),
  checks: z.array(verificationCheckSchema).optional(),
  error: inspectErrorSchema.optional()
}).strict();

export const inspectDraftResultSchema = z.discriminatedUnion("outcome", [
  validationFailedInspectResultSchema,
  validatedInspectResultSchema
]);

export type InspectDraftResult = z.infer<typeof inspectDraftResultSchema>;

export type RemotePost = {
  id: string;
  blogId?: string;
  status?: string;
  title?: string;
  content?: string;
  labels?: string[];
  customMetaData?: string;
};

export type InsertDraftRequest = {
  title: string;
  content: string;
  labels: string[];
  customMetaData: string;
};

export type AdapterFailure = {
  code: string;
  detail: string;
};

export type InsertDraftResult =
  | { ok: true; postId?: string }
  | ({ ok: false; kind: "auth" | "definitive" | "unknown" } & AdapterFailure);

export type GetPostResult =
  | { ok: true; post: RemotePost }
  | ({ ok: false; kind: "auth" | "absent" | "access_denied" | "unknown" } & AdapterFailure);

export interface BloggerAdapter {
  insertDraft(request: InsertDraftRequest): Promise<InsertDraftResult>;
  getPostAdmin(postId: string): Promise<GetPostResult>;
}
