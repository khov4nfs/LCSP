import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import type { QueryBus } from "@nestjs/cqrs";
import { GetLegalCorpusReadinessQuery } from "../../application/queries/get-legal-corpus-readiness/get-legal-corpus-readiness.query.js";
import { LegalCorpusReadinessController } from "./legal-corpus-readiness.controller.js";

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
        pinnedCorpusVersionId: "01234567",
      }) as GetLegalCorpusReadinessQuery,
    );
  });
});
