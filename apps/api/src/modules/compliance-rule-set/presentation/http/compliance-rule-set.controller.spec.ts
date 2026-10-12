import assert from "node:assert/strict";
import type { Server } from "node:http";

import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  COMPLIANCE_RULE_SET_ERROR_CODES,
} from "@lcsp/contracts/compliance-rule-set";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import supertest from "supertest";

import { validPacket } from "../../../../../test/support/compliance-rule-set-fixtures.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { isProblemResult } from "../../../../platform/http/filters/error.factory.js";
import { SubmitComplianceRuleSetCommand } from "../../application/commands/submit-compliance-rule-set/submit-compliance-rule-set.command.js";
import { ClaimRuleSetPreparationCommand } from "../../application/commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { GetActiveComplianceRuleSetQuery } from "../../application/queries/get-active-compliance-rule-set/get-active-compliance-rule-set.query.js";
import { ComplianceRuleSetController } from "./compliance-rule-set.controller.js";

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
    controller: new ComplianceRuleSetController(
      commandBus as unknown as CommandBus,
      queryBus as unknown as QueryBus,
    ),
  };
}

describe("ComplianceRuleSetController", () => {
  it("wraps every response in the shared success envelope and dispatches one Command/Query", async () => {
    const { controller, commandBus, queryBus } = build();
    await expect(
      controller.claim({ preparationRunId: "run-1" }, request),
    ).resolves.toMatchObject({ ok: true });
    await expect(controller.active(request)).resolves.toMatchObject({
      ok: true,
    });
    expect(commandBus.execute.mock.calls[0]?.[0]).toBeInstanceOf(
      ClaimRuleSetPreparationCommand,
    );
    expect(queryBus.execute.mock.calls[0]?.[0]).toBeInstanceOf(
      GetActiveComplianceRuleSetQuery,
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
    await controller.claim(
      { preparationRunId: "run-1", correlationId: "attacker" } as never,
      request,
    );
    const submit = commandBus.execute.mock
      .calls[0]?.[0] as SubmitComplianceRuleSetCommand;
    const claim = commandBus.execute.mock
      .calls[1]?.[0] as ClaimRuleSetPreparationCommand;
    expect(submit.actorId).toBe("rule-set-preparation-worker");
    expect(submit.correlationId).toBe("correlation-1");
    expect(claim.correlationId).toBe("correlation-1");
  });

  it("is guarded by the worker API key", () => {
    const guards = Reflect.getMetadata(
      "__guards__",
      ComplianceRuleSetController,
    ) as Array<{ name: string }>;
    expect(guards.map((guard) => guard.name)).toEqual(["WorkerApiKeyGuard"]);
  });
});

describe("ComplianceRuleSetController HTTP validation", () => {
  let app: INestApplication<Server>;
  const { commandBus, queryBus } = build();
  const workerKey = "compliance-rule-set-controller-test-key";

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ComplianceRuleSetController],
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

  it("exposes no route that starts a Rule Set Preparation: only the Legal Source activation consumer does", async () => {
    await supertest(app.getHttpServer())
      .post("/internal/compliance-rule-set/preparations")
      .set("x-worker-api-key", workerKey)
      .send({ legalSourceVersionId: "any", idempotencyKey: "any-key-12" })
      .expect(404);
    expect(commandBus.execute).not.toHaveBeenCalled();
  });

  it.each(["claims", "failures", "validations", "submissions"])(
    "rejects malformed %s before dispatch, with matching HTTP and problem status",
    async (route) => {
      const response = await supertest(app.getHttpServer())
        .post(`/internal/compliance-rule-set/${route}`)
        .set("x-worker-api-key", workerKey)
        .send({});
      expect(response.status).toBe(400);
      const result: unknown = response.body;
      assert.ok(isProblemResult(result));
      expect(result).toMatchObject({
        ok: false,
        problem: {
          status: 400,
          code: COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        },
      });
      if (route === "submissions") {
        expect(result.problem.meta?.issues).toBe(
          "preparationRunId,idempotencyKey,packet",
        );
      } else if (route === "validations") {
        expect(result.problem.meta?.issues).toBe("preparationRunId,packet");
      } else {
        expect(result.problem.meta?.issues).toBeUndefined();
      }
      expect(commandBus.execute).not.toHaveBeenCalled();
      expect(queryBus.execute).not.toHaveBeenCalled();
    },
  );

  it.each(["validations", "submissions"])(
    "rejects a structurally invalid coverage in %s as 400 with the exact field and requirement, never dispatching to persistence",
    async (route) => {
      const packet = validPacket();
      packet.legalRequirements[0].coverage = {
        state: LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
        nonAssessableReason: "stray reason",
      };
      const common = {
        preparationRunId: "0b6a2f6e-3f0a-4b8e-9a64-5b1b7c2d9e11",
        packet,
      };
      const response = await supertest(app.getHttpServer())
        .post(`/internal/compliance-rule-set/${route}`)
        .set("x-worker-api-key", workerKey)
        .send(
          route === "submissions"
            ? { ...common, idempotencyKey: "idempotency-key-1" }
            : common,
        );
      expect(response.status).toBe(400);
      const result: unknown = response.body;
      assert.ok(isProblemResult(result));
      expect(result.problem).toMatchObject({
        status: 400,
        code: COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      });
      expect(result.problem.meta?.issues).toBe(
        "packet.legalRequirements.0.coverage.nonAssessableReason",
      );
      expect(result.problem.meta?.requirements).toBe(
        "COVERED_BY_ASSESSMENT_RULES requires nonAssessableReason to be null",
      );
      expect(commandBus.execute).not.toHaveBeenCalled();
      expect(queryBus.execute).not.toHaveBeenCalled();
    },
  );

  it.each(["validations", "submissions"])(
    "authenticates before parsing malformed %s",
    async (route) => {
      await supertest(app.getHttpServer())
        .post(`/internal/compliance-rule-set/${route}`)
        .send({})
        .expect(401);
      expect(commandBus.execute).not.toHaveBeenCalled();
      expect(queryBus.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["validations", LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE],
    ["submissions", LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE],
    [
      "validations",
      LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
    ],
    [
      "submissions",
      LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
    ],
  ] as const)(
    "rejects contradictory %s coverage declared %s as structured 400 before dispatch",
    async (route, state) => {
      const packet = validPacket();
      const nonAssessable =
        state === LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE;
      if (nonAssessable) {
        packet.assessmentRules[1].legalRequirementIds.push(
          packet.legalRequirements[4].legalRequirementId,
        );
      } else {
        packet.assessmentRules[1].legalRequirementIds.pop();
      }
      const common = {
        preparationRunId: "0b6a2f6e-3f0a-4b8e-9a64-5b1b7c2d9e11",
        packet,
      };
      const response = await supertest(app.getHttpServer())
        .post(`/internal/compliance-rule-set/${route}`)
        .set("x-worker-api-key", workerKey)
        .send(
          route === "submissions"
            ? { ...common, idempotencyKey: "coverage-graph-check" }
            : common,
        );
      expect(response.status).toBe(400);
      const result: unknown = response.body;
      assert.ok(isProblemResult(result));
      expect(result.problem).toMatchObject({
        status: 400,
        code: COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      });
      expect(result.problem.meta?.issues).toBe(
        nonAssessable
          ? "packet.assessmentRules.1.legalRequirementIds.2"
          : "packet.legalRequirements.2.coverage.state",
      );
      expect(result.problem.meta?.requirements).toEqual(
        expect.stringContaining(state),
      );
      expect(
        String(result.problem.meta?.requirements).length,
      ).toBeLessThanOrEqual(800);
      expect(commandBus.execute).not.toHaveBeenCalled();
      expect(queryBus.execute).not.toHaveBeenCalled();
    },
  );
});
