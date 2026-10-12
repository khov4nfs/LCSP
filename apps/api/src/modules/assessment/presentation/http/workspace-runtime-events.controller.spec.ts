import { describe, expect, it, jest } from "@jest/globals";
import { QueryBus } from "@nestjs/cqrs";
import { firstValueFrom } from "rxjs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { WorkspaceRuntimeEventsController } from "./workspace-runtime-events.controller.js";
import { GetWorkspaceRuntimeQuery } from "../../application/queries/get-workspace-runtime/get-workspace-runtime.query.js";
const req = (
  role: import("@lcsp/contracts/auth").AuthUserRole = AUTH_USER_ROLES.customer,
) =>
  ({
    rbacContext: { userId: "owner", role, scope: null },
    correlationId: "corr",
  }) as AuthenticatedRequest;
describe("canonical workspace SSE transport", () => {
  it("dispatches an owner-scoped read and publishes only canonical payload", async () => {
    const execute = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        emittedAt: "2026-10-08T00:00:00.000Z",
        canonicalAssessments: [],
        canonicalEvents: [],
        runs: [{ status: "COMPLETE" }],
      });
    const event = await firstValueFrom(
      new WorkspaceRuntimeEventsController({
        execute,
      } as unknown as QueryBus).stream(req()),
    );
    expect(execute).toHaveBeenCalledWith(expect.any(GetWorkspaceRuntimeQuery));
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "owner" }),
    );
    expect(event).toEqual({
      type: "workspace.runtime",
      data: {
        emitted_at: "2026-10-08T00:00:00.000Z",
        canonical_assessments: [],
        canonical_events: [],
      },
    });
  });
  it("keeps admin streams outside customer case ownership", async () => {
    const execute = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        emittedAt: "2026-10-08T00:00:00.000Z",
        canonicalAssessments: [],
        canonicalEvents: [],
      });
    await firstValueFrom(
      new WorkspaceRuntimeEventsController({
        execute,
      } as unknown as QueryBus).stream(req(AUTH_USER_ROLES.admin)),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "no-assessment-owner:owner" }),
    );
  });
  it("fails closed for malformed persisted canonical rows", async () => {
    const execute = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        emittedAt: "2026-10-08T00:00:00.000Z",
        canonicalAssessments: [{ assessmentId: "invalid" }],
        canonicalEvents: [],
      });
    const event = await firstValueFrom(
      new WorkspaceRuntimeEventsController({
        execute,
      } as unknown as QueryBus).stream(req()),
    );
    expect(event.type).toBe("error");
  });
});
