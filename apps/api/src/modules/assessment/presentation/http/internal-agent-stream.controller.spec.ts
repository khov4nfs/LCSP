import { ConfigService } from "@nestjs/config";
import { CommandBus } from "@nestjs/cqrs";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { httpRequest, problemBody } from "../../../../../test/support/http.js";
import { ASSESSMENT_AGENT_STREAM_EVENT_TYPES } from "@lcsp/contracts/evidence";
import { ASSESSMENT_DOMAIN_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { HttpExceptionFilter } from "../../../../platform/http/index.js";
import { PublishAgentStreamEventCommand } from "../../application/commands/publish-agent-stream-event/publish-agent-stream-event.command.js";
import { InternalAgentStreamController } from "./internal-agent-stream.controller.js";

const workerKey = "release-synthetic-worker-key-for-transport-tests";
const payload = {
  event_id: "11111111-1111-4111-8111-111111111111",
  client_sequence: 1,
  emitted_at: "2026-10-08T13:00:00+00:00",
  assessment_id: "22222222-2222-4222-8222-222222222222",
  run_id: "33333333-3333-4333-8333-333333333333",
  correlation_id: "release-synthetic-correlation",
  event_type: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.boundaryStarted,
  source: "assessment_root_requested",
  data: { boundary: "assessment_root_requested" },
};

describe("canonical worker stream transport", () => {
  let app: INestApplication;
  const execute = jest.fn<CommandBus["execute"]>();

  beforeEach(async () => {
    execute
      .mockReset()
      .mockResolvedValue({ recorded: true, eventId: payload.event_id });
    const module = await Test.createTestingModule({
      controllers: [InternalAgentStreamController],
      providers: [
        WorkerApiKeyGuard,
        { provide: CommandBus, useValue: { execute } },
        { provide: ConfigService, useValue: { get: () => workerKey } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });
  afterEach(async () => app.close());

  it("accepts the actual worker envelope and dispatches one command", async () => {
    const response = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .set("x-worker-api-key", workerKey)
      .set("x-assessment-lease", "claimed-execution-lease")
      .send(payload);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      ok: true,
      data: { recorded: true, eventId: payload.event_id },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toBeInstanceOf(
      PublishAgentStreamEventCommand,
    );
    expect(
      (execute.mock.calls[0]?.[0] as PublishAgentStreamEventCommand).payload,
    ).toEqual(payload);
    expect(
      (execute.mock.calls[0]?.[0] as PublishAgentStreamEventCommand).leaseToken,
    ).toBe("claimed-execution-lease");
  });

  it("rejects unauthorized workers before dispatch", async () => {
    const response = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .send(payload);
    expect(response.status).toBe(401);
    expect(problemBody(response).code).toBe(AUTH_ERROR_CODES.sessionInvalid);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects malformed envelopes without exposing submitted values", async () => {
    const response = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .set("x-worker-api-key", workerKey)
      .send({
        ...payload,
        assessment_id: "",
        event_type: "private-invalid-value",
      });
    expect(response.status).toBe(422);
    const problem = problemBody(response);
    expect(problem.status).toBe(422);
    expect(problem.code).toBe(ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID);
    expect(JSON.stringify(response.body)).not.toContain(
      "private-invalid-value",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("exposes no old Scan ingress route", async () => {
    const response = await httpRequest(app)
      .post("/internal/scan-jobs/agent-stream-events")
      .set("x-worker-api-key", workerKey)
      .send(payload);
    expect(response.status).toBe(404);
    expect(execute).not.toHaveBeenCalled();
  });
});
