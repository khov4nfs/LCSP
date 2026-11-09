import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";
import { assertUnreviewedLegalCandidate } from "../scripts/lib/legal-review-guard.js";

const candidate = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/implementation-artifacts/lcsp347-pm-rereview/legal-source-candidates.unreviewed.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { candidates: Array<Record<string, unknown>>; approvedGold: boolean };

describe("Legal candidate export protection", () => {
  it("accepts the exact unreviewed package without changing its bytes or legal claims", () => {
    const value = candidate();
    const original = JSON.stringify(value);
    assertUnreviewedLegalCandidate(value);
    expect(JSON.stringify(value)).toBe(original);
    expect(value.approvedGold).toBe(false);
  });
  it.each([
    "actor",
    "action",
    "trigger",
    "lifecycleStage",
    "developerApplicability",
    "expectedDecision",
    "independentReviewerIdentity",
    "goldRevision",
    "goldHash",
  ])("preserves independently annotated %s", (field) => {
    const value = candidate();
    value.candidates[0][field] = "external annotation";
    expect(() => assertUnreviewedLegalCandidate(value)).toThrow(
      "must not be overwritten",
    );
  });
  it.each([null, {}, { candidates: [] }, { approvedGold: true }])(
    "rejects malformed or approved artifacts %j",
    (value) => {
      expect(() => assertUnreviewedLegalCandidate(value)).toThrow();
    },
  );
});
