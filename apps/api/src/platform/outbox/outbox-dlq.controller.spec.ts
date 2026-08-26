import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { jest } from "@jest/globals";

import { OutboxDlqController } from "./outbox-dlq.controller.js";
import { OutboxDlqService } from "./outbox-dlq.service.js";
import { RBAC_METADATA_KEY } from "../rbac/decorators/rbac-metadata.js";

describe("OutboxDlqController", () => {
  let controller: OutboxDlqController;
  let getDlqMessages: jest.MockedFunction<OutboxDlqService["getDlqMessages"]>;
  let replayMessage: jest.MockedFunction<OutboxDlqService["replayMessage"]>;
  let deleteMessage: jest.MockedFunction<OutboxDlqService["deleteMessage"]>;

  type ControllerRequest = Parameters<OutboxDlqController["replayMessage"]>[1];

  beforeEach(() => {
    getDlqMessages = jest.fn<OutboxDlqService["getDlqMessages"]>();
    replayMessage = jest.fn<OutboxDlqService["replayMessage"]>();
    deleteMessage = jest.fn<OutboxDlqService["deleteMessage"]>();

    controller = new OutboxDlqController({
      getDlqMessages,
      replayMessage,
      deleteMessage,
    } as unknown as OutboxDlqService);
  });

  it("requires the ADMIN role for DLQ operations", () => {
    const metadata = Reflect.getMetadata(
      RBAC_METADATA_KEY,
      OutboxDlqController,
    ) as unknown;

    expect(metadata).toEqual({
      type: "roles",
      roles: [AUTH_USER_ROLES.admin],
    });
  });

  it("returns DLQ messages", async () => {
    const mockResult = { messages: [], count: 0 };
    getDlqMessages.mockResolvedValue(mockResult);

    await expect(controller.getDlqMessages()).resolves.toEqual({
      ok: true,
      data: mockResult,
    });
  });

  it("replays a message using the authenticated user", async () => {
    const req = {
      rbacContext: { userId: "user-123" },
      correlationId: "corr-1",
    } as ControllerRequest;

    await expect(controller.replayMessage("1", req)).resolves.toEqual({
      ok: true,
      data: { success: true, message: "Message 1 queued for replay" },
    });
    expect(replayMessage).toHaveBeenCalledWith("1", "user-123", "corr-1");
  });

  it("deletes a message using the authenticated user", async () => {
    const req = {
      rbacContext: { userId: "user-123" },
      correlationId: "corr-2",
    } as ControllerRequest;

    await expect(controller.deleteMessage("1", req)).resolves.toEqual({
      ok: true,
      data: { success: true, message: "Message 1 permanently deleted" },
    });
    expect(deleteMessage).toHaveBeenCalledWith("1", "user-123", "corr-2");
  });
});
