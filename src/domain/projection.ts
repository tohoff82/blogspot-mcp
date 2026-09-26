import type { AuthoredProjection, ValidationIssue } from "./contracts.js";

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

const ROOT_FIELDS = new Set(["title", "body", "labels", "source"]);
const SOURCE_FIELDS = new Set(["artifact_id", "version_id"]);
const CONTROL_CHARACTER = /\p{Cc}/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function requiredString(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  if (typeof value !== "string") {
    issues.push(issue(path, "invalid_type", "Expected a string."));
    return undefined;
  }
  if (value.trim().length === 0) {
    issues.push(issue(path, "empty", "Must contain a non-whitespace character."));
    return undefined;
  }
  return value;
}

function normalizeLabels(value: unknown, issues: ValidationIssue[], labelsPath: string): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    issues.push(issue(labelsPath, "invalid_type", "Expected an array of strings."));
    return undefined;
  }

  const labels: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const path = `${labelsPath}.${index}`;
    if (typeof candidate !== "string") {
      issues.push(issue(path, "invalid_type", "Expected a string."));
      continue;
    }
    if (candidate.length === 0) {
      issues.push(issue(path, "empty", "Label must not be empty."));
      continue;
    }
    if (candidate.trim() !== candidate) {
      issues.push(issue(path, "surrounding_whitespace", "Label must not have surrounding whitespace."));
      continue;
    }
    if (candidate.includes(",")) {
      issues.push(issue(path, "comma_not_allowed", "Label must not contain a comma."));
      continue;
    }
    if (CONTROL_CHARACTER.test(candidate)) {
      issues.push(issue(path, "control_character", "Label must not contain control characters."));
      continue;
    }
    if (!seen.has(candidate)) {
      seen.add(candidate);
      labels.push(candidate);
    }
  }

  if (labels.length > 20) {
    issues.push(issue(labelsPath, "too_many", "At most 20 unique labels are allowed."));
  }
  const codePoints = labels.reduce((total, label) => total + Array.from(label).length, 0);
  if (codePoints > 200) {
    issues.push(issue(labelsPath, "too_long", "Unique labels may contain at most 200 Unicode code points in total."));
  }
  return labels;
}

export function validateProjection(value: unknown, basePath = ""): ValidationResult<AuthoredProjection> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [issue(basePath || "$", "invalid_type", "Expected an object.")] };
  }

  for (const field of Object.keys(value)) {
    if (!ROOT_FIELDS.has(field)) {
      issues.push(issue(basePath ? `${basePath}.${field}` : field, "unexpected_field", "Unexpected field."));
    }
  }

  const path = (field: string): string => basePath ? `${basePath}.${field}` : field;
  const title = requiredString(value.title, path("title"), issues);
  const rawBody = requiredString(value.body, path("body"), issues);
  const body = rawBody?.replace(/\r\n?/g, "\n");
  const labels = normalizeLabels(value.labels, issues, path("labels"));

  let artifactId: string | undefined;
  let versionId: string | undefined;
  if (!isRecord(value.source)) {
    issues.push(issue(path("source"), "invalid_type", "Expected an object."));
  } else {
    for (const field of Object.keys(value.source)) {
      if (!SOURCE_FIELDS.has(field)) {
        issues.push(issue(`${path("source")}.${field}`, "unexpected_field", "Unexpected field."));
      }
    }
    artifactId = requiredString(value.source.artifact_id, `${path("source")}.artifact_id`, issues);
    versionId = requiredString(value.source.version_id, `${path("source")}.version_id`, issues);
  }

  if (issues.length > 0 || title === undefined || body === undefined || labels === undefined || artifactId === undefined || versionId === undefined) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      title,
      body,
      labels,
      source: { artifact_id: artifactId, version_id: versionId }
    }
  };
}

export function validatePostId(value: unknown): ValidationResult<string> {
  if (typeof value !== "string") {
    return { ok: false, issues: [issue("post_id", "invalid_type", "Expected a string.")] };
  }
  if (!/^\d+$/u.test(value)) {
    return { ok: false, issues: [issue("post_id", "invalid_format", "Expected a non-empty decimal Blogger post ID.")] };
  }
  return { ok: true, value };
}
