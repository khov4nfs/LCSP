import assert from "node:assert/strict";
import type { Server } from "node:http";

import { LEGAL_PORTFOLIO_ERROR_CODES } from "@lcsp/contracts/legal-portfolio";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import supertest from "supertest";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { isProblemResult } from "../../../../platform/http/filters/error.factory.js";
import { SubmitLegalPortfolioCommand } from "../../application/commands/submit-legal-portfolio/submit-legal-portfolio.command.js";
import { StartLegalPreparationCommand } from "../../application/commands/start-legal-preparation/start-legal-preparation.command.js";
import { GetActiveLegalPortfolioQuery } from "../../application/queries/get-active-legal-portfolio/get-active-legal-portfolio.query.js";
import { LegalPortfolioController } from "./legal-portfolio.controller.js";

const request = { correlationId: "correlation-1" } as AuthenticatedRequest;

function build() {
  const commandBus = {
    execute: jest.fn((command: unknown) =>
      Promise.resolve({ executed: command }),
    ),
  };
  const queryBus = {
    execute: jest.fn((query: unknown) => Promise.resolve({ executed: query })),
  };
  return {
    commandBus,
    queryBus,
    controller: new LegalPortfolioController(
      commandBus as unknown as CommandBus,
      queryBus as unknown as QueryBus,
    ),
  };
}

describe("LegalPortfolioController", () => {
  it("wraps every response in the shared success envelope and dispatches one Command/Query", async () => {
    const { controller, commandBus, queryBus } = build();
    await expect(
      controller.startPreparation(
        { legalCorpusVersionId: "c", idempotencyKey: "k" },
        request,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(controller.active(request)).resolves.toMatchObject({
      ok: true,
    });
    expect(commandBus.execute.mock.calls[0]?.[0]).toBeInstanceOf(
      StartLegalPreparationCommand,
    );
    expect(queryBus.execute.mock.calls[0]?.[0]).toBeInstanceOf(
      GetActiveLegalPortfolioQuery,
    );
  });

  it("takes actor and correlation from the server, never from the body", async () => {
    const { controller, commandBus } = build();
    const body = {
      preparationRunId: "run-1",
      idempotencyKey: "k",
      packet: {},
      actorId: "attacker",
    } as never;
    await controller.submit(body, request);
    await controller.startPreparation(
      {
        legalCorpusVersionId: "c",
        idempotencyKey: "k",
        requestedBy: "attacker",
      } as never,
      request,
    );
    const submit = commandBus.execute.mock
      .calls[0]?.[0] as SubmitLegalPortfolioCommand;
    const start = commandBus.execute.mock
      .calls[1]?.[0] as StartLegalPreparationCommand;
    expect(submit.actorId).toBe("legal-preparation-worker");
    expect(submit.correlationId).toBe("correlation-1");
    expect(start.requestedBy).toBe("legal-preparation-worker");
    expect(start.correlationId).toBe("correlation-1");
  });

  it("is guarded by the worker API key", () => {
    const guards = Reflect.getMetadata(
      "__guards__",
      LegalPortfolioController,
    ) as Array<{ name: string }>;
    expect(guards.map((guard) => guard.name)).toEqual(["WorkerApiKeyGuard"]);
  });
});

describe("LegalPortfolioController HTTP validation", () => {
  let app: INestApplication<Server>;
  const { commandBus, queryBus } = build();
  const workerKey = "legal-portfolio-controller-test-key";

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LegalPortfolioController],
      providers: [
        { provide: CommandBus, useValue: commandBus },
        { provide: QueryBus, useValue: queryBus },
        {
          provide: ConfigService,
          useValue: new ConfigService({ worker: { apiKey: workerKey } }),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(["preparations", "claims", "failures", "validations", "submissions"])(
    "rejects malformed %s before dispatch, with matching HTTP and problem status",
    async (route) => {
      const response = await supertest(app.getHttpServer())
        .post(`/internal/legal-portfolio/${route}`)
        .set("x-worker-api-key", workerKey)
        .send({});
      expect(response.status).toBe(400);
      const result: unknown = response.body;
      assert.ok(isProblemResult(result));
      expect(result).toMatchObject({
        ok: false,
        problem: {
          status: 400,
          code: LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
        },
      });
      if (route === "submissions") {
        expect(result.problem.meta?.issues).toBe(
          "preparationRunId,idempotencyKey,packet",
        );
      } else {
        expect(result.problem.meta?.issues).toBeUndefined();
      }
      expect(commandBus.execute).not.toHaveBeenCalled();
      expect(queryBus.execute).not.toHaveBeenCalled();
    },
  );

  it("authenticates before parsing a malformed submit", async () => {
    await supertest(app.getHttpServer())
      .post("/internal/legal-portfolio/submissions")
      .send({})
      .expect(401);
    expect(commandBus.execute).not.toHaveBeenCalled();
  });
});
