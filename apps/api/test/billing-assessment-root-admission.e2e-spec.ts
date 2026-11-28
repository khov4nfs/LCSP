import * as assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  TOKEN_BUCKET_POLICIES,
} from "@lcsp/contracts/billing";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  ensureMigratedSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";

const execFileAsync = promisify(execFile);
const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(apiRoot, "../..");
const pythonBin = resolve(repoRoot, "deepagents/.venv/bin/python");
const workerKey = "test-worker-internal-api-key";
const leaseToken = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("G-06 Assessment Root boundary billing trace (test PostgreSQL)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Why: The fixture reset is destructive; TEST_DATABASE_URL has already passed the dedicated-test guard at import.
    // How: Bind NestJS and Prisma to the same disposable database before any fixture write.
    // Invariant: This test never connects to lcsp_local or enables real wallet debit.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = workerKey;
    process.env.BILLING_ADMISSION_MASTER_KEY =
      "server-dedicated-admission-master-key-secret-32b";
    process.env.MODEL_USAGE_DEBIT = MODEL_USAGE_DEBIT_MODES.OFF;
    await ensureMigratedSchema();
    // Why: Another test may have applied Prisma db push, which omits migration-only billing constraints.
    // How: Idempotently deploy the checked-in migrations on this already guarded test database.
    // Invariant: This never targets lcsp_local and preserves the admission/receipt triggers used by production.
    const cacheHome = resolve(apiRoot, ".cache");
    mkdirSync(cacheHome, { recursive: true });
    execFileSync(
      resolve(apiRoot, "node_modules/.bin/prisma"),
      ["migrate", "deploy"],
      {
        cwd: apiRoot,
        env: {
          ...process.env,
          DATABASE_URL: TEST_DATABASE_URL,
          XDG_CACHE_HOME: cacheHome,
        },
        stdio: "pipe",
      },
    );
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    await app.listen(0);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  it("passes a Root graph model attempt through server admission and consume before provider fixture invocation", async () => {
    // Why: Existing preparation E2Es cannot prove that the Assessment Root default graph reaches billing admission.
    // How: Run the real Root boundary and runner with a scripted provider, while NestJS billing endpoints and PostgreSQL stay real.
    // Invariant: The root control client and repository hydration are fixtures; this test is not proof of a complete production Root run.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "ModelOutputEvaluation", "ModelUsageReceipt", "BillableInvocationAdmission",
        "CustomerModelTariffAssignment", "CustomerModelTariffSnapshot",
        "CustomerModelTariffDraft", "BillingReservationInvocationClaim",
        "BillingReservation", "CreditLedgerEntry", "BillingWallet"
      CASCADE;
    `);
    await prisma.auditEvent.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    const fixture = await seedAuthWorkspaceFixture(prisma);
    const userId = fixture.approvedUser.id;
    const wallet = await prisma.billingWallet.create({
      data: {
        userId,
        availableCredits: 100n,
        balanceMicrocredits: 100_000_000n,
        accountingUnitVersion: 1,
      },
    });
    const assessment = await prisma.assessment.create({
      data: {
        id: `asm-root-g06-${randomUUID()}`,
        name: "G-06 Root fixture",
        ownerId: userId,
      },
    });
    await prisma.assessmentRuntime.create({
      data: {
        assessmentId: assessment.id,
        threadId: "00000000-0000-0000-0000-000000000099",
        rootAgentVersion: "1.0.0",
        checkpointNamespace: "test",
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 3_600_000),
        currentExecutionId: runId,
        executionState: "RUNNING",
      },
    });
    const snapshot = await prisma.customerModelTariffSnapshot.create({
      data: {
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        version: 1,
        accountingUnitVersion: 1,
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        idempotencyKey: `publish-root-g06-${randomUUID()}`,
        requestFingerprint: "a".repeat(64),
        publishedBy: "system-test",
        auditReason: "G-06 Root integration fixture",
      },
    });
    await prisma.customerModelTariffAssignment.create({
      data: {
        tariffSnapshotId: snapshot.id,
        scope: MODEL_PRICING_SCOPES.exactModel,
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        effectiveFrom: new Date(Date.now() - 3_600_000),
        effectiveTo: null,
        createdBy: "system-test",
      },
    });

    const httpServer = app.getHttpServer() as {
      address(): string | { port: number } | null;
    };
    const address = httpServer.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    assert.ok(port > 0);
    const pythonScript = `
import contextlib, json, sys, tempfile
from pathlib import Path
from types import SimpleNamespace
from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver
from deepagents.backends import FilesystemBackend
import assessment_root.boundary as root_boundary
from assessment_root.boundary import AssessmentRootBoundary
from assessment_root.runner import run_assessment_root
from middleware.usage_metering import AgentRunState, activate_agent_run_state
from test_assessment_root_agent import FakeClient, RootScriptedModel
from tools.common.capabilities.platform.api_client import WorkerApiClient

base_url, worker_key, assessment_id, run_id, lease = sys.argv[1:]
order = []
class GovernedRootFixtureModel(RootScriptedModel):
    provider: str = "anthropic"
    protocol: str = "anthropic"
    model_name: str = "claude-sonnet-4-6"
    profile: dict = {"max_output_tokens": 4096, "context_window_tokens": 1000000}
    def _get_ls_params(self, **kwargs):
        return {"ls_provider": "anthropic", "ls_model_type": "chat"}
    def _generate(self, messages, **kwargs):
        # Why: A provider attempt must never start before server-side consume commits its capability.
        # How: Capture the physical scripted dispatch at the model boundary after the live HTTP calls.
        # Invariant: This fixture raises if the admission/consume order is violated.
        order.append("provider")
        assert order[-3:] == ["request", "consume", "provider"]
        return super()._generate(messages, **kwargs)

client = FakeClient()
client.assessment_id = assessment_id
client.lease_token = lease
def claim(_assessment_id):
    return {"assessmentId": assessment_id, "threadId": "22222222-2222-4222-8222-222222222222",
            "executionId": run_id, "leaseToken": lease, "leaseExpiresAt": "2030-01-01T00:00:00.000Z",
            "checkpointNamespace": assessment_id, "executionState": "RUNNING"}
client.claim = claim
model = GovernedRootFixtureModel(responses=[AIMessage(content="fixture response", usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15})])
scratch = tempfile.TemporaryDirectory()
backend = FilesystemBackend(root_dir=Path(scratch.name), virtual_mode=True)
root_boundary.postgres_checkpointer = lambda: contextlib.nullcontext(InMemorySaver())
def runner(client_arg, assessment_arg, **options):
    return run_assessment_root(client_arg, assessment_arg,
        backend_factory=lambda *_: (backend, None), model=model,
        checkpointer=options["checkpointer"], store=options["store"])
boundary = AssessmentRootBoundary(SimpleNamespace(nestjs_api_base_url=base_url, worker_api_key=worker_key), client=client, runner=runner)
state = AgentRunState(run_id=run_id, assessment_id=assessment_id, agent_role="assessment-root",
                       api_client=WorkerApiClient(base_url, worker_key))
api_client = state.api_client
real_request = api_client.request_invocation_admission
real_consume = api_client.consume_invocation_admission
def traced_request(payload):
    result = real_request(payload)
    order.append("request")
    return result
def traced_consume(payload):
    result = real_consume(payload)
    order.append("consume")
    return result
api_client.request_invocation_admission = traced_request
api_client.consume_invocation_admission = traced_consume
state.execution_lease_token = lease
with activate_agent_run_state(state):
    try:
        outcome = boundary.handle({"assessmentId": assessment_id}, "corr-g06-root")
        outcome_state = outcome.get("state")
    except Exception as exc:
        outcome_state = type(exc).__name__
print(json.dumps({"modelCalls": len(model.prompts), "outcomeState": outcome_state, "order": order}))
`;
    const { stdout } = await execFileAsync(
      pythonBin,
      [
        "-c",
        pythonScript,
        `http://127.0.0.1:${port}`,
        workerKey,
        assessment.id,
        runId,
        leaseToken,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          PYTHONPATH: `${resolve(repoRoot, "deepagents")}:${resolve(repoRoot, "deepagents/tests")}`,
          PYTHONWARNINGS: "ignore",
          WORKER_ENVELOPE_ENCRYPTION_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
        encoding: "utf-8",
      },
    );
    const parsed: unknown = JSON.parse(
      stdout
        .trim()
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .pop() ?? "{}",
    );
    assert.ok(typeof parsed === "object" && parsed !== null);
    const modelCalls = (parsed as Record<string, unknown>).modelCalls;
    assert.ok(
      typeof modelCalls === "number" && modelCalls >= 1,
      `Root graph did not invoke fixture model: ${stdout}`,
    );
    const order = (parsed as Record<string, unknown>).order;
    assert.ok(Array.isArray(order));
    assert.equal(order.length, modelCalls * 3);
    for (let index = 0; index < order.length; index += 3) {
      assert.deepEqual(order.slice(index, index + 3), [
        "request",
        "consume",
        "provider",
      ]);
    }
    const admissions = await prisma.billableInvocationAdmission.findMany({
      where: { assessmentId: assessment.id },
    });
    assert.equal(admissions.length, modelCalls);
    for (const admission of admissions) {
      assert.equal(admission.walletId, wallet.id);
      assert.equal(
        admission.fundingPrincipal,
        ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
      );
      assert.equal(admission.debitMode, MODEL_USAGE_DEBIT_MODES.OFF);
      assert.equal(admission.tariffSnapshotId, snapshot.id);
      const consumedState = admission.state;
      assert.ok(
        consumedState === ADMISSION_STATES.IN_FLIGHT ||
          consumedState === ADMISSION_STATES.OUTCOME_UNKNOWN ||
          consumedState === ADMISSION_STATES.SETTLED,
        `Expected admission to have been consumed, got ${consumedState}`,
      );
    }
  });
});
