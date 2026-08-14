import * as assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import {
  pushPrismaSchema,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest } from "./support/http.js";

const WORKER_KEY = "test-only-worker-api-key-at-least-32-chars";

type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
};

describe("Python worker runtime bridge (e2e) [LCSP-234]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let workerServerPort = 0;
  let captured: CapturedRequest[] = [];

  const workerServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const body = await readJson(req);
        captured.push({
          method: req.method ?? "GET",
          path: req.url ?? "/",
          headers: req.headers,
          body,
        });

        if (req.url === "/runtime/commands/request-targeted-reanalysis") {
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              data: {
                status: "READY",
                execution_mode: "ASYNC_ACCEPTED",
                request_ref: "reanalysis:req-1",
                state: "QUEUED",
              },
            }),
          );
          return;
        }

        if (req.url === "/runtime/commands/legal-corpus/resume-waiting-runs") {
          res.writeHead(202, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              data: {
                status: "READY",
                execution_mode: "ASYNC_ACCEPTED",
                request_ref: "resume:req-1",
                state: "QUEUED",
              },
            }),
          );
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      })();
    },
  );

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_KEY;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    await new Promise<void>((resolve) => {
      workerServer.listen(0, "127.0.0.1", () => {
        const address = workerServer.address();
        if (address && typeof address === "object") {
          workerServerPort = address.port;
        }
        resolve();
      });
    });
    process.env.PYTHON_WORKER_BASE_URL = `http://127.0.0.1:${workerServerPort}`;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    captured = [];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
    await new Promise<void>((resolve, reject) => {
      workerServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it("bridges request_targeted_reanalysis through PYTHON_WORKER_BASE_URL", async () => {
    const response = (await httpRequest(app)
      .post("/internal/evidence/agentic-tools/dispatch")
      .set("X-Worker-Api-Key", WORKER_KEY)
      .set("X-Correlation-Id", "corr-rt-1")
      .send({
        tool_name: "request_targeted_reanalysis",
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        workflow_run_id: "run-rt-1",
        artifact_versions: {
          technicalEvidenceReportId: "ter_12345678",
        },
        input: {
          analyzerId: "RUN_PYTHON_SEMANTIC_ANALYSIS",
          scope: { pathPrefixes: ["apps/api/"] },
          reasonRequirementId: "requirement:gap_12345678",
          idempotencyKey: "request_targeted_reanalysis_0001",
        },
        correlationId: "corr-rt-1",
      })) as { status: number; body: { ok: boolean; data: { state: string } } };

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.state, "QUEUED");
    assert.equal(captured.length, 1);
    assert.equal(
      captured[0]?.path,
      "/runtime/commands/request-targeted-reanalysis",
    );
    assert.equal(captured[0]?.headers["x-worker-api-key"], WORKER_KEY);
    assert.equal(captured[0]?.headers["x-correlation-id"], "corr-rt-1");
    assert.deepEqual(captured[0]?.body, {
      assessmentId: "assessment-1",
      organizationId: "org-1",
      userId: "user-1",
      inputArtifactVersion: "ter_12345678",
      analyzerId: "RUN_PYTHON_SEMANTIC_ANALYSIS",
      scope: { pathPrefixes: ["apps/api/"] },
      reasonRequirementId: "requirement:gap_12345678",
      idempotencyKey: "request_targeted_reanalysis_0001",
    });

    const events = (await (
      prisma as unknown as {
        assessmentRuntimeEvent: {
          findMany: (args: Record<string, unknown>) => Promise<
            Array<{
              eventType: string;
              toolName: string | null;
            }>
          >;
        };
      }
    ).assessmentRuntimeEvent.findMany({
      where: {
        assessmentId: "assessment-1",
        runId: "run-rt-1",
      },
      orderBy: { sequence: "asc" },
    })) as Array<{ eventType: string; toolName: string | null }>;
    assert.deepEqual(
      events.map((event) => event.eventType),
      ["RUN_STARTED", "TOOL_STARTED", "TOOL_COMPLETED"],
    );
    assert.equal(events[1]?.toolName, "request_targeted_reanalysis");
  });

  it("bridges resume_waiting_runs through PYTHON_WORKER_BASE_URL", async () => {
    const response = (await httpRequest(app)
      .post("/internal/evidence/agentic-tools/dispatch")
      .set("X-Worker-Api-Key", WORKER_KEY)
      .set("X-Correlation-Id", "corr-rt-2")
      .send({
        tool_name: "resume_waiting_runs",
        assessment_id: "assessment-1",
        organization_id: "org-1",
        user_id: "user-1",
        workflow_run_id: "run-rt-2",
        artifact_versions: {
          corpusVersionId: "corpus-1",
        },
        input: {
          maxRuns: 15,
          idempotencyKey: "resume_waiting_runs_0001",
        },
        correlationId: "corr-rt-2",
      })) as { status: number; body: { ok: boolean; data: { state: string } } };

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.data.state, "QUEUED");
    assert.equal(captured.length, 1);
    assert.equal(
      captured[0]?.path,
      "/runtime/commands/legal-corpus/resume-waiting-runs",
    );
    assert.equal(captured[0]?.headers["x-worker-api-key"], WORKER_KEY);
    assert.equal(captured[0]?.headers["x-correlation-id"], "corr-rt-2");
    assert.deepEqual(captured[0]?.body, {
      corpusVersionId: "corpus-1",
      maxRuns: 15,
      idempotencyKey: "resume_waiting_runs_0001",
    });

    const events = (await (
      prisma as unknown as {
        assessmentRuntimeEvent: {
          findMany: (args: Record<string, unknown>) => Promise<
            Array<{
              eventType: string;
              toolName: string | null;
            }>
          >;
        };
      }
    ).assessmentRuntimeEvent.findMany({
      where: {
        assessmentId: "assessment-1",
        runId: "run-rt-2",
      },
      orderBy: { sequence: "asc" },
    })) as Array<{ eventType: string; toolName: string | null }>;
    assert.deepEqual(
      events.map((event) => event.eventType),
      ["RUN_STARTED", "TOOL_STARTED", "TOOL_COMPLETED"],
    );
    assert.equal(events[1]?.toolName, "resume_waiting_runs");
  });
});

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(
      typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk),
    );
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}
