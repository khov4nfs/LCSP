import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import supertest from "supertest";

import { isProblemResult } from "../../../../platform/http/filters/error.factory.js";
import { AssessmentDomainController } from "./assessment-domain.controller.js";
import { ReportUnresolvableHumanFactCommand } from "../../application/commands/report-unresolvable-human-fact/report-unresolvable-human-fact.command.js";

describe("AssessmentDomainController transport validation", () => {
  let app: INestApplication<Server>;
  const execute = jest.fn<(command: unknown) => Promise<unknown>>(() =>
    Promise.resolve({}),
  );
  const workerKey = "assessment-domain-controller-test-key";

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AssessmentDomainController],
      providers: [
        { provide: CommandBus, useValue: { execute } },
        { provide: QueryBus, useValue: { execute } },
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

  it("rejects a malformed assessment ID before dispatch", async () => {
    const response = await supertest(app.getHttpServer())
      .post("/internal/assessment-runtime/not-a-uuid/claim")
      .set("x-worker-api-key", workerKey);
    expect(response.status).toBe(422);
    const result: unknown = response.body;
    assert.ok(isProblemResult(result));
    expect(result.problem).toMatchObject({
      status: 422,
      code: ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed leases before malformed body content", async () => {
    const response = await supertest(app.getHttpServer())
      .post(`/internal/assessment-runtime/${randomUUID()}/finish`)
      .set("x-worker-api-key", workerKey)
      .set("x-assessment-lease", "malformed")
      .send({});
    expect(response.status).toBe(403);
    const result: unknown = response.body;
    assert.ok(isProblemResult(result));
    expect(result.problem).toMatchObject({
      status: 403,
      code: ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("validates finish with the shared contract before dispatch", async () => {
    const response = await supertest(app.getHttpServer())
      .post(`/internal/assessment-runtime/${randomUUID()}/finish`)
      .set("x-worker-api-key", workerKey)
      .set("x-assessment-lease", randomUUID())
      .send({ state: "INVALID" });
    expect(response.status).toBe(422);
    const result: unknown = response.body;
    assert.ok(isProblemResult(result));
    expect(result.problem.status).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects model-supplied lifecycle state on the human dependency boundary", async () => {
    const response = await supertest(app.getHttpServer())
      .post(
        `/internal/assessment-runtime/${randomUUID()}/human-fact-unresolvable`,
      )
      .set("x-worker-api-key", workerKey)
      .set("x-assessment-lease", randomUUID())
      .send({
        humanResolutionRequestId: randomUUID(),
        expectedCaseRevision: 0,
        expectedRequestRevision: 0,
        rationale: "Records are permanently unavailable under the contract.",
        evidenceIds: [randomUUID()],
        state: ASSESSMENT_LIFECYCLE_STATES.BLOCKED,
      });
    expect(response.status).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });

  it("dispatches a validated human dependency claim as one command", async () => {
    const assessmentId = randomUUID();
    const lease = randomUUID();
    const body = {
      humanResolutionRequestId: randomUUID(),
      expectedCaseRevision: 0,
      expectedRequestRevision: 0,
      rationale: "Records are permanently unavailable under the contract.",
      evidenceIds: [randomUUID()],
    };
    const response = await supertest(app.getHttpServer())
      .post(
        `/internal/assessment-runtime/${assessmentId}/human-fact-unresolvable`,
      )
      .set("x-worker-api-key", workerKey)
      .set("x-assessment-lease", lease)
      .send(body);
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.any(ReportUnresolvableHumanFactCommand),
    );
  });
});
