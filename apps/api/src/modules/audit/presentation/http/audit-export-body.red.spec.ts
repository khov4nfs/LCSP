import { AUDIT_ERROR_CODES } from "@lcsp/contracts/audit";
import { jest } from "@jest/globals";
import type { CommandBus, QueryBus } from "@nestjs/cqrs";

import { AuditController } from "./audit.controller.js";

describe("audit export body validation", () => {
  it("rejects a missing date before dispatching a command", async () => {
    const execute = jest.fn<() => Promise<unknown>>();
    const controller = new AuditController(
      { execute } as unknown as CommandBus,
      {} as QueryBus,
      {} as never,
    );
    await expect(
      controller.exportAuditTrail(
        { from_date: "2026-01-01T00:00:00Z" } as never,
        {
          rbacContext: { userId: "user-1" },
          correlationId: "corr-1",
        } as never,
      ),
    ).rejects.toMatchObject({
      response: { problem: { code: AUDIT_ERROR_CODES.invalidQuery } },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
