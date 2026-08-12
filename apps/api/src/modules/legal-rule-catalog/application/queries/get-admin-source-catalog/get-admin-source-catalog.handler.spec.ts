import { HttpException } from "@nestjs/common";
import { jest } from "@jest/globals";

import {
  AGENTIC_TOOL_STATUSES,
  ADMIN_SOURCE_CATALOG_LIMITATION_CODES,
} from "@lcsp/contracts/evidence";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { AdminSourceCatalogService } from "../../services/admin-source-catalog.service.js";
import { GetAdminSourceCatalogHandler } from "./get-admin-source-catalog.handler.js";
import { GetAdminSourceCatalogQuery } from "./get-admin-source-catalog.query.js";

function createHandler(input?: { assessment?: object | null }) {
  const assessmentFindFirst = jest
    .fn<() => Promise<object | null>>()
    .mockResolvedValue(
      input?.assessment === undefined
        ? { id: "assessment-1" }
        : input.assessment,
    );
  const prisma = {
    assessment: { findFirst: assessmentFindFirst },
  } as unknown as PrismaService;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const audit = { write } as unknown as AuditWriterService;
  const catalog = new AdminSourceCatalogService();
  return {
    handler: new GetAdminSourceCatalogHandler(prisma, audit, catalog),
    write,
  };
}

function query(
  input: ConstructorParameters<typeof GetAdminSourceCatalogQuery>[2],
) {
  return new GetAdminSourceCatalogQuery(
    "assessment-1",
    "organization-1",
    input,
    "user-1",
    "policy-1",
    "1",
    "correlation-1",
  );
}

describe("GetAdminSourceCatalogHandler", () => {
  it("TC-01: resolves an exact admin-managed catalog source by catalog ID", async () => {
    const { handler, write } = createHandler();

    const response = await handler.execute(
      query({ catalogId: "catalog_vbpl_vn" }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.ready);
    expect(response.result.allowedHost).toBe("vbpl.vn");
    expect(response.result.catalogSourceRef).toContain(
      "catalog-source:vbpl.vn",
    );
    expect(JSON.stringify(write.mock.calls)).toContain(
      "AGENTIC_TOOL_ADMIN_SOURCE_CATALOG_READ",
    );
  });

  it("TC-02: returns conflict when identity does not map uniquely to a catalog source", async () => {
    const { handler } = createHandler();

    const response = await handler.execute(
      query({
        documentIdentity: {
          documentType: "DECREE",
          documentNumber: "13/2023/NĐ-CP",
          issuingAuthority: "Chính phủ",
          issueDate: "2026-08-12",
        },
      }),
    );

    expect(response.status).toBe(AGENTIC_TOOL_STATUSES.conflict);
    expect(response.limitations[0]?.code).toBe(
      ADMIN_SOURCE_CATALOG_LIMITATION_CODES.catalogLookupAmbiguous,
    );
  });

  it("TC-03: fails closed for an assessment outside the caller organization", async () => {
    const { handler } = createHandler({ assessment: null });

    await expect(
      handler.execute(query({ catalogId: "catalog_vbpl_vn" })),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
