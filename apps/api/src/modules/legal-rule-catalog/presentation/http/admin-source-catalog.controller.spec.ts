import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";
import type { QueryBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { GetAdminSourceCatalogQuery } from "../../application/queries/get-admin-source-catalog/get-admin-source-catalog.query.js";
import { AdminSourceCatalogController } from "./admin-source-catalog.controller.js";

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

describe("AdminSourceCatalogController", () => {
  it("TC-01: parses a strict catalog-id request into the immutable query", async () => {
    const execute = jest.fn<QueryBus["execute"]>().mockResolvedValue({
      status: "READY",
    });
    const controller = new AdminSourceCatalogController({
      execute,
    } as unknown as QueryBus);

    await controller.getAdminSourceCatalog(
      "assessment-1",
      { catalog_id: "catalog_vbpl_vn" },
      request(),
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        organizationId: "organization-1",
        input: { catalogId: "catalog_vbpl_vn" },
      }) as GetAdminSourceCatalogQuery,
    );
  });

  it("TC-02: rejects partial or extra identity fields before query dispatch", async () => {
    const execute = jest.fn<QueryBus["execute"]>();
    const controller = new AdminSourceCatalogController({
      execute,
    } as unknown as QueryBus);

    await expect(
      controller.getAdminSourceCatalog(
        "assessment-1",
        {
          document_type: "LAW",
          issuing_authority: "Quốc hội",
          issue_date: "2026-08-12",
          raw_url: "https://evil.example",
        },
        request(),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(execute).not.toHaveBeenCalled();
  });
});
