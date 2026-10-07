import { describe, expect, it, jest } from "@jest/globals";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import type { LegalPortfolioService } from "../../application/services/legal-portfolio.service.js";
import { LegalPortfolioController } from "./legal-portfolio.controller.js";

const request = { correlationId: "correlation-1" } as AuthenticatedRequest;

function build() {
  const service = {
    startPreparation: jest.fn((input: unknown) =>
      Promise.resolve({ preparationRunId: "run-1", input }),
    ),
    submit: jest.fn((input: unknown) =>
      Promise.resolve({ portfolioVersionId: "portfolio-1", input }),
    ),
    getActivePortfolio: jest.fn((correlationId: string) =>
      Promise.resolve({ portfolioVersionId: "portfolio-1", correlationId }),
    ),
  };
  return {
    service,
    controller: new LegalPortfolioController(
      service as unknown as LegalPortfolioService,
    ),
  };
}

describe("LegalPortfolioController", () => {
  it("wraps every response in the shared success envelope", async () => {
    const { controller } = build();
    await expect(
      controller.startPreparation({}, request),
    ).resolves.toMatchObject({ ok: true, data: { preparationRunId: "run-1" } });
    await expect(controller.submit({}, request)).resolves.toMatchObject({
      ok: true,
      data: { portfolioVersionId: "portfolio-1" },
    });
    await expect(controller.active(request)).resolves.toMatchObject({
      ok: true,
      data: { portfolioVersionId: "portfolio-1" },
    });
  });

  it("takes actor and correlation from the server, never from the body", async () => {
    const { controller, service } = build();
    const body = {
      actorId: "attacker",
      requestedBy: "attacker",
      preparationRunId: "run-1",
    };
    await controller.submit(body, request);
    await controller.startPreparation(body, request);
    expect(service.submit).toHaveBeenCalledWith({
      body,
      actorId: "legal-preparation-worker",
      correlationId: "correlation-1",
    });
    expect(service.startPreparation).toHaveBeenCalledWith({
      body,
      requestedBy: "legal-preparation-worker",
      correlationId: "correlation-1",
    });
  });

  it("is guarded by the worker API key", () => {
    const guards = Reflect.getMetadata(
      "__guards__",
      LegalPortfolioController,
    ) as Array<{ name: string }>;
    expect(guards.map((guard) => guard.name)).toEqual(["WorkerApiKeyGuard"]);
  });
});
