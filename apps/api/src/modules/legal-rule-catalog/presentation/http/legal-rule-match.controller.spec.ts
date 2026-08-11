import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GetLegalRuleMatchQuery } from "../../application/queries/get-legal-rule-match/get-legal-rule-match.query.js";
import { LegalRuleMatchController } from "./legal-rule-match.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: "Manager",
      scope: null,
      grantedActions: [PBAC_ACTIONS.legalRuleMatchRead],
      selectedAction: PBAC_ACTIONS.legalRuleMatchRead,
      policyId: "policy-1",
      policyVersion: "1",
    },
  } as AuthenticatedRequest;
}

describe("LegalRuleMatchController", () => {
  it("TC-02: rejects duplicate citations and unexpected payload keys before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new LegalRuleMatchController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.getLegalRuleMatch(
        "assessment-1",
        {
          verifiedProfileId: "profile_verified1",
          ruleId: "rule_notice1",
          citationRefs: ["citation:chunk_123456", "citation:chunk_123456"],
          prompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable immutable rule-match inputs", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: "READY" });
    const controller = new LegalRuleMatchController({
      execute,
    } as unknown as QueryBus);

    await controller.getLegalRuleMatch(
      "assessment-1",
      {
        verifiedProfileId: "profile_verified1",
        ruleId: "rule_notice1",
        citationRefs: ["citation:chunk_123456"],
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          verifiedProfileId: "profile_verified1",
          ruleId: "rule_notice1",
          citationRefs: ["citation:chunk_123456"],
        },
      }) as GetLegalRuleMatchQuery,
    );
  });
});
