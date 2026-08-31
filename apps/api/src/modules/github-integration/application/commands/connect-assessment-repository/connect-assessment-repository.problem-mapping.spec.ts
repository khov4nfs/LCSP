import { describe, expect, it } from "@jest/globals";
import { AUTH_ERROR_CODES, REQUIRED_ACTIONS } from "@lcsp/contracts/auth";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";
import {
  internalServerProblem,
  problemResult,
} from "../../../../../platform/problems/problem-factory.js";

describe("ConnectAssessmentRepository problem requiredAction mapping", () => {
  it("keeps internal/provider failures out of LCSP sign-in", () => {
    expect(internalServerProblem("correlation").problem.requiredAction).toBe(
      REQUIRED_ACTIONS.none,
    );
    expect(
      problemResult(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
        "correlation",
        { status: 401 },
      ).problem.requiredAction,
    ).toBe(REQUIRED_ACTIONS.none);
  });

  it("retains sign-in for an actual LCSP authentication failure", () => {
    expect(
      problemResult(AUTH_ERROR_CODES.authRequired, "correlation", {
        status: 401,
      }).problem.requiredAction,
    ).toBe(REQUIRED_ACTIONS.signIn);
  });
});
