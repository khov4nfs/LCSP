import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import {
  WIZARD_CLAIM_COMPARISON_SCOPES,
  WIZARD_CLAIM_EXPECTED_VALUES,
  WIZARD_CLAIM_FIELDS,
} from "@lcsp/contracts/evidence";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { CompareWizardClaimQuery } from "../../application/queries/compare-wizard-claim/compare-wizard-claim.query.js";
import { CompareWizardClaimController } from "./compare-wizard-claim.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "corr-1",
    rbacContext: {},
  } as AuthenticatedRequest;
}

function queryBusWithResolvedValue(value: unknown) {
  return {
    execute: jest
      .fn<(query: unknown) => Promise<unknown>>()
      .mockResolvedValue(value),
  };
}

describe("CompareWizardClaimController.compareWizardClaim", () => {
  it("forwards a validated wizard-claim comparison request to the protected query", async () => {
    const queryBus = queryBusWithResolvedValue({
      result: { verdict: "SUPPORTED" },
    });
    const controller = new CompareWizardClaimController(queryBus as never);

    await controller.compareWizardClaim(
      "assessment-1",
      "wizard-1",
      "report-1",
      "target:provider_openai",
      WIZARD_CLAIM_FIELDS.provider,
      WIZARD_CLAIM_EXPECTED_VALUES.openai,
      WIZARD_CLAIM_COMPARISON_SCOPES.target,
      "7",
      request(),
    );

    expect(queryBus.execute).toHaveBeenCalledWith(
      new CompareWizardClaimQuery(
        "assessment-1",
        "wizard-1",
        "report-1",
        "target:provider_openai",
        WIZARD_CLAIM_FIELDS.provider,
        WIZARD_CLAIM_EXPECTED_VALUES.openai,
        WIZARD_CLAIM_COMPARISON_SCOPES.target,
        7,
        "corr-1",
      ),
    );
  });

  it("rejects malformed target refs and invalid expected values before dispatch", async () => {
    const queryBus = { execute: jest.fn() };
    const controller = new CompareWizardClaimController(queryBus as never);

    await expect(
      controller.compareWizardClaim(
        "assessment-1",
        "wizard-1",
        "report-1",
        "provider_openai",
        WIZARD_CLAIM_FIELDS.provider,
        WIZARD_CLAIM_EXPECTED_VALUES.openai,
        WIZARD_CLAIM_COMPARISON_SCOPES.target,
        "7",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    await expect(
      controller.compareWizardClaim(
        "assessment-1",
        "wizard-1",
        "report-1",
        "target:provider_openai",
        WIZARD_CLAIM_FIELDS.provider,
        WIZARD_CLAIM_EXPECTED_VALUES.production,
        WIZARD_CLAIM_COMPARISON_SCOPES.target,
        "7",
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);

    expect(queryBus.execute).not.toHaveBeenCalled();
  });
});
