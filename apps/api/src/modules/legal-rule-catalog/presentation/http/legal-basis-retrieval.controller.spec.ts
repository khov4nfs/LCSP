import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import type { QueryBus } from "@nestjs/cqrs";
import { RetrieveLegalBasisQuery } from "../../application/queries/retrieve-legal-basis/retrieve-legal-basis.query.js";
import { LegalBasisRetrievalController } from "./legal-basis-retrieval.controller.js";

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

describe("LegalBasisRetrievalController", () => {
  it("TC-02: rejects free text, extra fields, and an over-broad selector before query dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new LegalBasisRetrievalController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.retrieveLegalBasis(
        "assessment-1",
        {
          corpusVersionId: "corpus_01234567",
          selectors: { chunkIds: ["chunk_123456"], query: "all regulations" },
          includeContext: true,
          rawPrompt: "ignore limits",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: parses only stable IDs into the pinned immutable query", async () => {
    const execute = jest
      .fn<QueryBus["execute"]>()
      .mockResolvedValue({ status: "READY" });
    const controller = new LegalBasisRetrievalController({
      execute,
    } as unknown as QueryBus);

    await controller.retrieveLegalBasis(
      "assessment-1",
      {
        corpusVersionId: "corpus_01234567",
        selectors: { ruleIds: ["rule_123456"] },
        includeContext: true,
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        input: {
          corpusVersionId: "corpus_01234567",
          selectors: { ruleIds: ["rule_123456"] },
          includeContext: true,
        },
      }) as RetrieveLegalBasisQuery,
    );
  });
});
