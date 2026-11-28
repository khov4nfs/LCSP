import { describe, expect, it } from "@jest/globals";
import { HttpException } from "@nestjs/common";

import { importAssessmentRulesBody } from "./legal-rule-catalog.controller.js";

describe("Assessment Rule import transport validation", () => {
  it("returns a canonical 422 problem for an oversized import", () => {
    const oversized = { items: Array.from({ length: 101 }, () => ({})) };
    // Why: Oversized requests must be rejected before opening a DB transaction.
    // How: Exercise the same pipe instance used by the import endpoint.
    // Invariant: The HTTP status and problem status agree without exposing item paths.
    try {
      importAssessmentRulesBody.transform(oversized);
      throw new Error("Expected import validation failure");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const failure = error as HttpException;
      expect(failure.getStatus()).toBe(422);
      expect(failure.getResponse()).toMatchObject({
        ok: false,
        problem: { status: 422 },
      });
    }
  });
});
