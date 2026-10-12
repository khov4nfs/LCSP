import { describe, expect, it, jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import { RBAC_METADATA_KEY } from "../../../../platform/rbac/decorators/rbac-metadata.js";
import { PinSnapshotCommand } from "../../application/commands/pin-snapshot/pin-snapshot.command.js";
import { GitHubIntegrationController } from "./github-integration.controller.js";

describe("GitHubIntegrationController.pinSnapshot", () => {
  it("requires CUSTOMER role", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      GitHubIntegrationController.prototype.pinSnapshot,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.customer],
    });
  });

  it("dispatches an assessment and actor scoped PinSnapshotCommand", async () => {
    const execute = jest
      .fn<(command: unknown) => Promise<{ snapshot_id: string }>>()
      .mockResolvedValue({ snapshot_id: "snapshot-1" });
    const controller = new GitHubIntegrationController(
      { execute } as unknown as CommandBus,
      {} as unknown as QueryBus,
    );

    await controller.pinSnapshot(
      "assessment-1",
      { connection_id: "connection-1", branch: "main" },
      {
        correlationId: "corr-1",
        rbacContext: {
          userId: "customer-1",
          sessionId: "session-1",
          role: AUTH_USER_ROLES.customer,
          scope: null,
        },
      },
    );

    expect(execute.mock.calls[0][0]).toBeInstanceOf(PinSnapshotCommand);
    expect(execute.mock.calls[0][0]).toMatchObject({
      assessmentId: "assessment-1",
      actorId: "customer-1",
      connectionId: "connection-1",
      branch: "main",
      correlationId: "corr-1",
    });
  });
});
