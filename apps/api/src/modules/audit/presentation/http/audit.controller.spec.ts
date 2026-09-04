import { AUDIT_ERROR_CODES } from "@lcsp/contracts/audit";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { Response } from "express";

import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { ExportAuditTrailCommand } from "../../application/commands/export-audit-trail/export-audit-trail.command.js";
import { GetAuditExportArtifactQuery } from "../../application/queries/get-audit-export-artifact/get-audit-export-artifact.query.js";
import { GetAuditExportQuery } from "../../application/queries/get-audit-export/get-audit-export.query.js";
import { GetInterviewAuditTrailQuery } from "../../application/queries/get-interview-audit-trail/get-interview-audit-trail.query.js";
import { ListAuditEventsQuery } from "../../application/queries/list-audit-events/list-audit-events.query.js";
import { AuditExportStorageService } from "../../infrastructure/storage/audit-export-storage.service.js";
import { AuditController } from "./audit.controller.js";

describe("AuditController", () => {
  it("requires the ADMIN role to read audit events", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AuditController.prototype.listAuditEvents,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.admin],
    });
  });

  it("dispatches the audit-event list query", async () => {
    const execute =
      jest.fn<(query: unknown) => Promise<{ events: unknown[] }>>();
    execute.mockResolvedValue({ events: [] });
    const controller = new AuditController(
      {} as CommandBus,
      { execute } as unknown as QueryBus,
      {} as AuditExportStorageService,
    );

    await controller.listAuditEvents(
      "auth.sign_in",
      "user-1",
      "2026-07-01T00:00:00.000Z",
      "2026-07-31T23:59:59.999Z",
      "2",
      "10",
      {
        rbacContext: { userId: "user-1" },
        correlationId: "corr-1",
      } as never,
    );

    const dispatched = execute.mock.calls[0]?.[0];
    expect(dispatched).toBeInstanceOf(ListAuditEventsQuery);
    expect(dispatched).toMatchObject({
      eventType: "auth.sign_in",
      actorId: "user-1",
      page: 2,
      pageSize: 10,
      correlationId: "corr-1",
    });
  });

  it("requires the ADMIN role to request an audit export", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AuditController.prototype.exportAuditTrail,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.admin],
    });
  });

  it("dispatches export command with requester context", async () => {
    const execute = jest
      .fn<(command: unknown) => Promise<{ export_request_id: string }>>()
      .mockResolvedValue({ export_request_id: "export-1" });
    const controller = new AuditController(
      { execute } as unknown as CommandBus,
      {} as QueryBus,
      {} as AuditExportStorageService,
    );

    await controller.exportAuditTrail(
      {
        from_date: "2026-07-01T00:00:00.000Z",
        to_date: "2026-07-31T23:59:59.999Z",
      },
      {
        rbacContext: { userId: "user-1" },
        correlationId: "corr-1",
      } as never,
    );

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(ExportAuditTrailCommand);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      requestedById: "user-1",
      correlationId: "corr-1",
    });
  });

  it("dispatches status query for an export request", async () => {
    const execute = jest
      .fn<(query: unknown) => Promise<{ export_request_id: string }>>()
      .mockResolvedValue({ export_request_id: "export-1" });
    const controller = new AuditController(
      {} as CommandBus,
      { execute } as unknown as QueryBus,
      {} as AuditExportStorageService,
    );

    await controller.getAuditExport("export-1", {
      rbacContext: { userId: "user-1" },
      correlationId: "corr-1",
    } as never);

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(GetAuditExportQuery);
  });

  it("rejects download without signed token", async () => {
    const controller = new AuditController(
      {} as CommandBus,
      {} as QueryBus,
      new AuditExportStorageService(),
    );

    await expect(
      controller.downloadAuditExport("export-1", undefined, {} as Response),
    ).rejects.toMatchObject({
      response: {
        ok: false,
        problem: { code: AUDIT_ERROR_CODES.downloadUrlInvalid },
      },
    });
  });

  it("streams a signed export artifact download", async () => {
    const execute = jest
      .fn<(query: unknown) => Promise<Record<string, unknown>>>()
      .mockResolvedValue({ export_request_id: "export-1", events: [] });
    const storage = new AuditExportStorageService();
    const token = storage
      .createSignedDownloadUrl({
        exportRequestId: "export-1",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .split("token=")[1];
    const setHeader = jest.fn<Response["setHeader"]>();
    const send = jest.fn<Response["send"]>();
    const controller = new AuditController(
      {} as CommandBus,
      { execute } as unknown as QueryBus,
      storage,
    );

    await controller.downloadAuditExport("export-1", token, {
      setHeader,
      send,
    } as never);

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      GetAuditExportArtifactQuery,
    );
    expect(send).toHaveBeenCalledWith(
      JSON.stringify({ export_request_id: "export-1", events: [] }, null, 2),
    );
  });

  it("requires CUSTOMER or ADMIN role to retrieve assessment interview audit trail", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AuditController.prototype.getAssessmentInterviewAudit,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin],
    });
  });

  it("dispatches the interview audit trail query with rbac context", async () => {
    const execute = jest
      .fn<
        (
          query: unknown,
        ) => Promise<{ assessmentId: string; events: unknown[]; total: number }>
      >()
      .mockResolvedValue({
        assessmentId: "assessment-42",
        events: [],
        total: 0,
      });
    const controller = new AuditController(
      {} as CommandBus,
      { execute } as unknown as QueryBus,
      {} as AuditExportStorageService,
    );

    const result = await controller.getAssessmentInterviewAudit(
      "assessment-42",
      {
        rbacContext: {
          userId: "user-42",
          role: AUTH_USER_ROLES.customer,
          scope: "assessment:assessment-42",
        },
        correlationId: "corr-interview-audit-42",
      } as never,
    );

    expect(result).toEqual({
      ok: true,
      data: {
        assessmentId: "assessment-42",
        events: [],
        total: 0,
      },
    });

    const dispatched = execute.mock.calls[0]?.[0];
    expect(dispatched).toBeInstanceOf(GetInterviewAuditTrailQuery);
    expect(dispatched).toMatchObject({
      assessmentId: "assessment-42",
      sessionUserId: "user-42",
      subjectRole: AUTH_USER_ROLES.customer,
      subjectScope: "assessment:assessment-42",
      correlationId: "corr-interview-audit-42",
    });
  });
});
