import { describe, expect, it } from "vitest";
import { classifyChecks } from "../../src/domain/outcomes.js";
import type { VerificationCheck } from "../../src/domain/contracts.js";

const check = (result: VerificationCheck["result"]): VerificationCheck => ({
  name: "title",
  result,
  expected: "expected",
  observed: "observed"
});

describe("verification outcome classification", () => {
  it("requires every check to match", () => {
    expect(classifyChecks([check("MATCH"), check("MATCH")])).toBe("VERIFIED");
    expect(classifyChecks([check("MATCH"), check("UNKNOWN")])).toBe("UNKNOWN");
    expect(classifyChecks([check("UNKNOWN"), check("MISMATCH")])).toBe("MISMATCH");
  });
});
