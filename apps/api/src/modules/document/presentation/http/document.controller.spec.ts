import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { GetDocumentQuery } from "../../application/queries/get-document/get-document.query.js";
import { RequestGapAnalysisCommand } from "../../application/commands/request-gap-analysis/request-gap-analysis.command.js";
import { DocumentController } from "./document.controller.js";

describe("DocumentController role-only RBAC", () => {
  it("requires CUSTOMER for final report generation", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      DocumentController.prototype.requestFinalReport,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
    });
  });

  it("requires CUSTOMER for gap analysis generation", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      DocumentController.prototype.requestGapAnalysis,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
    });
  });

  it("allows CUSTOMER and ADMIN to read document status", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      DocumentController.prototype.getDocument,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin],
    });
  });
});

describe("DocumentController dispatch", () => {
  it("dispatches RequestGapAnalysisCommand", async () => {
    const execute = jest.fn<CommandBus["execute"]>().mockResolvedValue({});
    const controller = new DocumentController(
      { execute } as unknown as CommandBus,
      { execute: jest.fn() } as unknown as QueryBus,
      { verifySignedDownloadToken: jest.fn() } as never,
    );
    const req = {
      rbacContext: {
        userId: "user-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.customer,
        scope: "asmt-1",
      },
      correlationId: "corr-1",
    } as unknown as Parameters<DocumentController["requestGapAnalysis"]>[1];

    await controller.requestGapAnalysis("asmt-1", req);

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      RequestGapAnalysisCommand,
    );
  });

  it("dispatches GetDocumentQuery with actor role", async () => {
    const execute = jest.fn<QueryBus["execute"]>().mockResolvedValue({});
    const controller = new DocumentController(
      { execute: jest.fn() } as unknown as CommandBus,
      { execute } as unknown as QueryBus,
      { verifySignedDownloadToken: jest.fn() } as never,
    );

    await controller.getDocument("assessment-1", "doc-1", {
      correlationId: "corr-1",
      rbacContext: {
        userId: "admin-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.admin,
        scope: "assessment-1",
      },
    } as never);

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(GetDocumentQuery);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      assessmentId: "assessment-1",
      documentRequestId: "doc-1",
      actorRole: AUTH_USER_ROLES.admin,
      correlationId: "corr-1",
    });
  });

  it("redirects to the verified artifact url", () => {
    const controller = new DocumentController(
      { execute: jest.fn() } as unknown as CommandBus,
      { execute: jest.fn() } as unknown as QueryBus,
      {
        verifySignedDownloadToken: jest.fn(() => ({
          documentUrl: "https://example.test/doc.pdf",
        })),
      } as never,
    );

    expect(
      controller.downloadDocument("assessment-1", "doc-1", "signed-token"),
    ).toEqual({ url: "https://example.test/doc.pdf" });
  });

  it("rejects an invalid download token", () => {
    const controller = new DocumentController(
      { execute: jest.fn() } as unknown as CommandBus,
      { execute: jest.fn() } as unknown as QueryBus,
      { verifySignedDownloadToken: jest.fn(() => null) } as never,
    );

    expect(() =>
      controller.downloadDocument("assessment-1", "doc-1", "bad-token"),
    ).toThrow("Bad Request Exception");
  });
});
