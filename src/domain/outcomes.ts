import type { VerificationCheck } from "./contracts.js";

export type VerificationOutcome = "VERIFIED" | "MISMATCH" | "UNKNOWN";

export function classifyChecks(checks: VerificationCheck[]): VerificationOutcome {
  if (checks.some(check => check.result === "MISMATCH")) return "MISMATCH";
  if (checks.some(check => check.result === "UNKNOWN")) return "UNKNOWN";
  return "VERIFIED";
}
