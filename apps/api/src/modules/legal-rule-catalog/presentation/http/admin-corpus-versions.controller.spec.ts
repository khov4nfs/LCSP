import { describe, expect, it, jest } from "@jest/globals";

import { AdminCorpusVersionsController } from "./admin-corpus-versions.controller.js";

describe("AdminCorpusVersionsController", () => {
  it("returns the shared success envelope for list and detail reads", async () => {
    const service = {
      list: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        currentActive: null,
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, hasNext: false },
        canCreate: false,
      }),
      detail: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ id: "corpus-1" }),
    };
    const controller = new AdminCorpusVersionsController(service as never);

    await expect(controller.list()).resolves.toEqual({
      ok: true,
      data: {
        currentActive: null,
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, hasNext: false },
        canCreate: false,
      },
    });
    await expect(controller.detail("corpus-1")).resolves.toEqual({
      ok: true,
      data: { id: "corpus-1" },
    });
  });

  it("exposes no publish or discard write route", () => {
    expect(AdminCorpusVersionsController.prototype).not.toHaveProperty(
      "publish",
    );
    expect(AdminCorpusVersionsController.prototype).not.toHaveProperty(
      "discard",
    );
  });

  it("treats an omitted prepare body as an invalid idempotency request", async () => {
    const service = {
      list: jest.fn<() => Promise<unknown>>(),
      detail: jest.fn<() => Promise<unknown>>(),
      prepare: jest
        .fn<(input: unknown) => Promise<unknown>>()
        .mockResolvedValue({ id: "prep-1" }),
    };
    const controller = new AdminCorpusVersionsController(service as never);

    await controller.prepare(undefined, undefined, {
      correlationId: "corr-2",
      rbacContext: { userId: "admin-1" },
    } as never);

    expect(service.prepare).toHaveBeenCalledWith({
      actorId: "admin-1",
      idempotencyKey: "",
      correlationId: "corr-2",
    });
  });
});
