import { describe, expect, it, jest } from "@jest/globals";

import { AdminCorpusVersionsController } from "./admin-corpus-versions.controller.js";

describe("AdminCorpusVersionsController", () => {
  it("returns the shared success envelope for list and detail reads", async () => {
    const service = {
      list: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        currentPublished: null,
        versions: [],
        canCreate: false,
      }),
      detail: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ id: "corpus-1" }),
      discardDraft: jest.fn<(input: unknown) => Promise<unknown>>(),
    };
    const controller = new AdminCorpusVersionsController(service as never);

    await expect(controller.list()).resolves.toEqual({
      ok: true,
      data: { currentPublished: null, versions: [], canCreate: false },
    });
    await expect(controller.detail("corpus-1")).resolves.toEqual({
      ok: true,
      data: { id: "corpus-1" },
    });
  });

  it("passes authenticated actor context into audited draft discard", async () => {
    const service = {
      list: jest.fn<() => Promise<unknown>>(),
      detail: jest.fn<() => Promise<unknown>>(),
      discardDraft: jest
        .fn<(input: unknown) => Promise<unknown>>()
        .mockResolvedValue({ id: "corpus-1", status: "REJECTED" }),
    };
    const controller = new AdminCorpusVersionsController(service as never);

    await controller.discard("corpus-1", {
      correlationId: "corr-1",
      rbacContext: { userId: "admin-1" },
    } as never);
    expect(service.discardDraft).toHaveBeenCalledWith({
      versionId: "corpus-1",
      actorId: "admin-1",
      correlationId: "corr-1",
    });
  });
});
