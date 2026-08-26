import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { GetScanJobQuery } from "../../application/queries/get-scan-job/get-scan-job.query.js";
import { RerunScanCommand } from "../../application/commands/rerun-scan/rerun-scan.command.js";
import { RequestTargetedReanalysisCommand } from "../../application/commands/request-targeted-reanalysis/request-targeted-reanalysis.command.js";
import { InternalScanController, ScanController } from "./scan.controller.js";

describe("ScanController role-only RBAC", () => {
  it("allows CUSTOMER and ADMIN to read scan jobs", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.getScanJob,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin],
    });
  });

  it("requires CUSTOMER for scan reruns", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.rerunScan,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
    });
  });

  it("requires CUSTOMER for targeted reanalysis", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      ScanController.prototype.requestTargetedReanalysis,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
    });
  });

  it("dispatches GetScanJobQuery with role and scope", async () => {
    const execute = jest.fn<(query: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ scan_job_id: "scan-job-1" });
    const controller = new ScanController(
      { execute } as unknown as QueryBus,
      {} as unknown as CommandBus,
    );

    await controller.getScanJob("assessment-1", "scan-job-1", {
      correlationId: "corr-1",
      rbacContext: {
        userId: "admin-1",
        sessionId: "session-1",
        role: AUTH_USER_ROLES.admin,
        scope: "assessment-1",
      },
    });

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(GetScanJobQuery);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      assessmentId: "assessment-1",
      scanJobId: "scan-job-1",
      subjectRole: AUTH_USER_ROLES.admin,
      scope: "assessment-1",
      correlationId: "corr-1",
    });
  });

  it("dispatches RerunScanCommand with role-only request context", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({
      id: "new-scan-job-2",
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
    });
    const controller = new ScanController(
      {} as unknown as QueryBus,
      { execute } as unknown as CommandBus,
    );
    const rbacContext = {
      userId: "customer-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: "assessment-1",
    };

    await controller.rerunScan(
      "assessment-1",
      {
        snapshot_id: "snapshot-1",
        idempotency_key: "key-1",
        reason: "Test rerun",
      },
      { correlationId: "corr-1", rbacContext },
    );

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(RerunScanCommand);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "key-1",
      rbacContext,
      correlationId: "corr-1",
      reason: "Test rerun",
    });
  });

  it("dispatches targeted reanalysis with role-only request context", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ status: "READY" });
    const controller = new ScanController(
      {} as unknown as QueryBus,
      { execute } as unknown as CommandBus,
    );
    const rbacContext = {
      userId: "customer-1",
      sessionId: "session-1",
      role: AUTH_USER_ROLES.customer,
      scope: "assessment-1",
    };

    await controller.requestTargetedReanalysis(
      "assessment-1",
      "ter_12345678",
      {
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_TS_JS_SEMANTIC_ANALYSIS",
        scope: { pathPrefixes: ["src/web/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      { correlationId: "corr-1", rbacContext },
    );

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      RequestTargetedReanalysisCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      input: {
        assessmentId: "assessment-1",
        inputArtifactVersion: "ter_12345678",
      },
      rbacContext,
      correlationId: "corr-1",
    });
  });
});

describe("InternalScanController", () => {
  it("creates targeted reanalysis with a synthetic CUSTOMER worker context", async () => {
    const execute = jest.fn<(command: unknown) => Promise<unknown>>();
    execute.mockResolvedValue({ status: "READY" });
    const controller = new InternalScanController(
      { execute } as unknown as CommandBus,
      {} as never,
    );

    await controller.createTargetedReanalysis(
      {
        assessmentId: "assessment-1",
        userId: "user-1",
        inputArtifactVersion: "ter_12345678",
        analyzerId: "RUN_SEMGREP_RULES",
        scope: { pathPrefixes: ["apps/api/"] },
        reasonRequirementId: "requirement:gap_12345678",
        idempotencyKey: "request_targeted_reanalysis_0001",
      },
      "corr-1",
    );

    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      RequestTargetedReanalysisCommand,
    );
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      rbacContext: {
        userId: "user-1",
        sessionId: "worker-runtime",
        role: AUTH_USER_ROLES.customer,
        scope: "assessment-1",
      },
      correlationId: "corr-1",
    });
  });
});
