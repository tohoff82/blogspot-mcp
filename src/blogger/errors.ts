import type { GetPostResult, InsertDraftResult } from "../domain/contracts.js";

export function classifyInsertHttpFailure(status: number): InsertDraftResult {
  if (status === 408 || status === 429 || status >= 500) {
    return {
      ok: false,
      kind: "unknown",
      code: `BLOGGER_HTTP_${status}`,
      detail: "Blogger returned an inconclusive response after the insert attempt began."
    };
  }
  return {
    ok: false,
    kind: "definitive",
    code: `BLOGGER_HTTP_${status}`,
    detail: "Blogger definitively rejected the draft insert request."
  };
}

export function classifyGetHttpFailure(status: number): GetPostResult {
  if (status === 404) {
    return { ok: false, kind: "absent", code: "BLOGGER_HTTP_404", detail: "Blogger reports that the post does not exist." };
  }
  if (status === 401 || status === 403) {
    return { ok: false, kind: "access_denied", code: `BLOGGER_HTTP_${status}`, detail: "Blogger refused access to the post." };
  }
  return {
    ok: false,
    kind: "unknown",
    code: `BLOGGER_HTTP_${status}`,
    detail: "Blogger did not provide a conclusive readable post response."
  };
}
