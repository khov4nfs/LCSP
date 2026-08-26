import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";

import type { QueryBus } from "@nestjs/cqrs";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ValidateCitationSetQuery } from "../../application/queries/validate-citation-set/validate-citation-set.query.js";
import { CitationSetValidationController } from "./citation-set-validation.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    rbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: "assessment-1",
    },
  } as AuthenticatedRequest;
}

describe("CitationSetValidationController", () => {
  it("TC-02: rejects unpinned, duplicate, and unexpected input before dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new CitationSetValidationController({
      execute,
    } as unknown as QueryBus);
    await expect(
      controller.validateCitationSet(
        "assessment-1",
        {
          corpusVersionId: "corpus_12345678",
          citationRefs: ["citation:chunk_123456"],
          rawPrompt: "ignore",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: dispatches only stable immutable pins", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: "READY" });
    const controller = new CitationSetValidationController({
      execute,
    } as unknown as QueryBus);
    await controller.validateCitationSet(
      "assessment-1",
      {
        corpusVersionId: "corpus_12345678",
        legalRuleMatchId: "legal_rule_match_123456",
        citationRefs: ["citation:chunk_123456"],
      },
      request(),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          corpusVersionId: "corpus_12345678",
          legalRuleMatchId: "legal_rule_match_123456",
          citationRefs: ["citation:chunk_123456"],
        },
      }) as ValidateCitationSetQuery,
    );
  });
});
