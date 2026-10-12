import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { ExecutionContext, INestApplication } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import supertest from "supertest";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AnswerHumanRequestCommand } from "../../application/commands/answer-human-request/answer-human-request.command.js";
import { AssessmentHumanResolutionController } from "./assessment-human-resolution.controller.js";

describe("Human Resolution transport", () => {
  let app: INestApplication<Server>;
  let server: Server;
  const execute = jest
    .fn<(command: unknown) => Promise<{ resumed: boolean }>>()
    .mockResolvedValue({ resumed: false });
  const actor = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    role: AUTH_USER_ROLES.customer,
    scope: null,
  };
  const assessmentId = randomUUID(),
    requestId = randomUUID();
  const route = `/assessments/${assessmentId}/human-requests/${requestId}/answers`;
  const body = {
    doesNotKnow: false,
    answer: "Operations team",
    expectedCaseRevision: 1,
    expectedRequestRevision: 0,
    idempotencyKey: "answer-transport-check",
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AssessmentHumanResolutionController],
      providers: [
        { provide: CommandBus, useValue: { execute } },
        { provide: QueryBus, useValue: { execute } },
      ],
    })
      .overrideGuard(RbacGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context
            .switchToHttp()
            .getRequest<AuthenticatedRequest>().rbacContext = actor;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer();
  });
  beforeEach(() => {
    execute.mockClear();
  });
  afterAll(async () => {
    await app.close();
  });
  it("dispatches the fact-only contract and server actor once", async () => {
    const response = await supertest(server).post(route).send(body);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, data: { resumed: false } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        assessmentId,
        requestId,
        actor,
        request: body,
      }),
    );
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      AnswerHumanRequestCommand,
    );
  });
  it.each([
    { ...body, answer: "" },
    { ...body, compliance: "COMPLIANT" },
    { ...body, doesNotKnow: true },
    { ...body, expectedRequestRevision: -1 },
  ])(
    "rejects malformed or verdict-bearing answers before dispatch",
    async (payload) => {
      const response = await supertest(server).post(route).send(payload);
      expect(response.status).toBe(422);
      expect(
        z
          .object({
            problem: z.object({ status: z.number(), code: z.string() }),
          })
          .parse(response.body).problem,
      ).toMatchObject({
        status: 422,
        code: ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_ANSWER_INVALID,
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );
  it("validates request identity", async () => {
    const response = await supertest(server)
      .post(`/assessments/${assessmentId}/human-requests/not-a-uuid/answers`)
      .send(body);
    expect(response.status).toBe(422);
    expect(execute).not.toHaveBeenCalled();
  });
});
