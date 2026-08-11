import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import type { QueryBus } from "@nestjs/cqrs";
import { GetLegalCorpusReadinessQuery } from "../../application/queries/get-legal-corpus-readiness/get-legal-corpus-readiness.query.js";
import { LegalCorpusReadinessController } from "./legal-corpus-readiness.controller.js";

function request(): AuthenticatedRequest {
  return {
    correlationId: "correlation-1",
    pbacContext: {
      userId: "user-1",
      sessionId: "session-1",
      organizationId: "organization-1",
      subjectRole: "Manager",
      scope: null,
      grantedActions: [PBAC_ACTIONS.legalCorpusRead],
      selectedAction: PBAC_ACTIONS.legalCorpusRead,
      policyId: "policy-1",
      policyVersion: "1",
    },
  } as AuthenticatedRequest;
}

describe("LegalCorpusReadinessController", () => {
  it("TC-02: rejects malformed and extra query fields before query dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new LegalCorpusReadinessController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.getLegalCorpusReadiness(
        "assessment-1",
        { effective_date: "2026-02-29", raw_text: "no" },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });

  it("TC-01: parses the strict request into the immutable query", async () => {
    const execute = jest.fn<QueryBus["execute"]>().mockResolvedValue({
      status: "READY",
    });
    const controller = new LegalCorpusReadinessController({
      execute,
    } as unknown as QueryBus);

    await controller.getLegalCorpusReadiness(
      "assessment-1",
      {
        effective_date: "2026-08-12",
        pinned_corpus_version_id: "corpus_01234567",
      },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        organizationId: "organization-1",
        pinnedCorpusVersionId: "01234567",
      }) as GetLegalCorpusReadinessQuery,
    );
  });
});
