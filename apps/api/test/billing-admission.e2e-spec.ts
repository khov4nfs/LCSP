import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mkdirSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  TOKEN_BUCKET_POLICIES,
  computeAdmissionRequestFingerprint,
  deriveAdmissionCapabilityDigest,
  deriveAdmissionCapabilitySecret,
  type BillableInvocationAdmissionRequest,
  type BillableInvocationAdmissionResponse,
} from "@lcsp/contracts/billing";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  ensureMigratedSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemBody, successBody } from "./support/http.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(testDir, "..");
const WORKER_TEST_API_KEY = "test-worker-internal-api-key";
const defaultLeaseToken = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const defaultRunId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function listeningPort(application: INestApplication): number {
  // Why: Nest's generic HTTP-server return is untyped, while these tests require a real bound port.
  // How: Narrow the Node server surface and validate the address before building the worker URL.
  // Invariant: A missing listener fails before a Python subprocess can call an unintended endpoint.
  const server = application.getHttpServer() as {
    address(): AddressInfo | string | null;
  };
  const address = server.address();
  assert.ok(address && typeof address !== "string" && address.port > 0);
  return address.port;
}

function pythonResult(line: string): Record<string, unknown> {
  // Why: JSON.parse returns any, which can conceal malformed subprocess output.
  // How: Require an object before its individual fields are asserted by the caller.
  // Invariant: Python stdout is never trusted as a typed success receipt without validation.
  const value: unknown = JSON.parse(line);
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function ensureIdempotentMigrateDeploy(): void {
  const cacheHome = resolve(apiRoot, ".cache");
  mkdirSync(cacheHome, { recursive: true });
  const prismaBinary =
    process.platform === "win32"
      ? resolve(apiRoot, "node_modules/.bin/prisma.cmd")
      : resolve(apiRoot, "node_modules/.bin/prisma");
  execFileSync(prismaBinary, ["migrate", "deploy"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      XDG_CACHE_HOME: cacheHome,
    },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

describe("WP8 Phase B: Server-issued Admission Control & Concurrency Slot (Postgres e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let customerUserId: string;
  let customerWalletId: string;
  let assessmentId: string;
  let publishedSnapshotId: string;
  let publishedAssignmentId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_TEST_API_KEY;
    process.env.BILLING_ADMISSION_MASTER_KEY =
      "server-dedicated-admission-master-key-secret-32b";
    await ensureMigratedSchema();
    ensureIdempotentMigrateDeploy();

    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
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

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "BillableInvocationAdmission" ENABLE TRIGGER "BillableInvocationAdmission_initial_exposure_insert";
      ALTER TABLE "BillableInvocationAdmission" ENABLE TRIGGER "BillableInvocationAdmission_initial_exposure_immutable";
      TRUNCATE TABLE
        "ModelOutputEvaluation",
        "ModelUsageReceipt",
        "BillableInvocationAdmission",
        "PlatformSponsorshipPolicySnapshot",
        "CustomerModelTariffAssignment",
        "CustomerModelTariffSnapshot",
        "CustomerModelTariffDraft",
        "BillingReservationInvocationClaim",
        "BillingReservation",
        "CreditLedgerEntry",
        "BillingWallet"
      CASCADE;
    `);
    await prisma.auditEvent.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    const fixture = await seedAuthWorkspaceFixture(prisma);
    customerUserId = fixture.approvedUser.id;

    // Ensure wallet exists for customer with 100 credits (100,000,000 microcredits)
    const wallet = await prisma.billingWallet.create({
      data: {
        userId: customerUserId,
        availableCredits: 100n,
        balanceMicrocredits: 100_000_000n,
        accountingUnitVersion: 1,
      },
    });
    customerWalletId = wallet.id;

    // Create an assessment owned by customer
    const assessment = await prisma.assessment.create({
      data: {
        id: `asm-e2e-${Date.now()}-${randomUUID()}`,
        name: "Admission E2E Assessment",
        ownerId: customerUserId,
      },
    });
    assessmentId = assessment.id;

    // Create an active AssessmentRuntime for assessmentId with default lease and run
    await prisma.assessmentRuntime.create({
      data: {
        assessmentId,
        threadId: "00000000-0000-0000-0000-000000000099",
        rootAgentVersion: "1.0.0",
        checkpointNamespace: "test",
        leaseToken: defaultLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
        currentExecutionId: defaultRunId,
        executionState: "RUNNING",
      },
    });

    // Publish a valid tariff snapshot & assignment for Anthropic Claude Sonnet 4.6 (canonical allowlist model)
    const snapshot = await prisma.customerModelTariffSnapshot.create({
      data: {
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        normalizedScopeKey: `EXACT_MODEL:anthropic:claude-sonnet-4-6`,
        version: 1,
        accountingUnitVersion: 1,
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        idempotencyKey: `publish-admission-${Date.now()}-${randomUUID()}`,
        requestFingerprint: "a".repeat(64),
        publishedBy: "system-test",
        auditReason: "E2E Admission seed tariff",
      },
    });
    publishedSnapshotId = snapshot.id;

    const assignment = await prisma.customerModelTariffAssignment.create({
      data: {
        tariffSnapshotId: snapshot.id,
        scope: MODEL_PRICING_SCOPES.exactModel,
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        effectiveFrom: new Date(Date.now() - 3600_000), // 1 hour ago
        effectiveTo: null,
        createdBy: "system-test",
      },
    });
    publishedAssignmentId = assignment.id;
  });

  // Why: The callback cannot be exposed until retention and delivery semantics are approved.
  // How: Keep this acceptance scenario as a pending contract while route registration is disabled.
  // Invariant: The current application has no worker-callable verdict writer.
  it.skip("A3 pending retention: binds rule-authoring rejection to one immutable journal row and physical receipt", async () => {
    // Why: A future DOMAIN_REJECTED verdict needs a durable evaluator event beyond a callback's self-claim.
    // How: Publish the actual CUSTOM_PROGRESS shape and inspect the persisted journal row by server event ID.
    // Invariant: Rejection evidence must remain bound to one preparation run and tool call.
    const source = await prisma.legalSourceVersion.create({
      data: { version: `causation-${randomUUID()}`, sourceManifest: {} },
    });
    const preparationRunId = `prep-causation-${randomUUID()}`;
    const admissionId = randomUUID();
    const invocationId = randomUUID();
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: preparationRunId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "RUNNING",
        correlationId: `corr-${preparationRunId}`,
        idempotencyKey: `idem-${preparationRunId}`,
      },
    });
    const published = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        preparation_run_id: preparationRunId,
        run_id: preparationRunId,
        event_type: "CUSTOM_PROGRESS",
        data: {
          activity_kind: "RULE_AUTHORING_TOOL_REJECTED",
          rejection: {
            toolCallId: "call-a",
            physicalInvocationId: invocationId,
            rejectionCode: "CLAIM_IDENTITY_CONFLICT",
            sequence: 1,
            argsFingerprint: "a".repeat(32),
          },
        },
      });
    assert.equal(published.status, 202);
    const eventId = successBody<{ recorded: boolean; eventId: string }>(
      published,
    ).eventId;
    const rows = await prisma.assessmentRuntimeEvent.findMany({
      where: { preparationRunId },
    });
    const matched = rows.find((row) => {
      const output = row.outputSummaryJson as {
        agentStreamEvent?: { eventId?: string };
      } | null;
      return output?.agentStreamEvent?.eventId === eventId;
    });
    assert.ok(matched);
    assert.equal(matched.runId, preparationRunId);
    const output = matched.outputSummaryJson as {
      agentStreamEvent: {
        data?: { rejection?: { toolCallId?: string; rejectionCode?: string } };
      };
    };
    assert.equal(output.agentStreamEvent.data?.rejection?.toolCallId, "call-a");
    assert.equal(
      output.agentStreamEvent.data?.rejection?.rejectionCode,
      "CLAIM_IDENTITY_CONFLICT",
    );
    // Why: The DB unique index covers rejection events only; ordinary progress
    // may legitimately reuse this worker event ID in the same run.
    // How: Publish that coexistence before the verdict callback.
    // Invariant: A future evaluator must scope its journal query to rejection
    // kind and boundary, otherwise a normal event can falsely make it ambiguous.
    const unrelatedProgress = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        preparation_run_id: preparationRunId,
        run_id: preparationRunId,
        event_type: "CUSTOM_PROGRESS",
        event_id: eventId,
        data: { activity_kind: "OTHER" },
      });
    assert.equal(unrelatedProgress.status, 202);

    // Why: A worker callback alone cannot prove a rejected tool belongs to a paid physical response.
    // How: Seed the exact settled admission/receipt/evaluation chain and reference the persisted event.
    // Invariant: Only the pinned call ID may transition the evaluation; financial receipt stays unchanged.
    await prisma.billableInvocationAdmission.create({
      data: {
        id: admissionId,
        invocationId,
        admissionRequestId: randomUUID(),
        requestFingerprint: "rejection-fixture",
        logicalOperationId: randomUUID(),
        attemptOrdinal: 1,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
        preparationRunId,
        runId: preparationRunId,
        agentRole: "rule-preparation",
        operationType: "PREPARATION",
        requestedModel: "claude-sonnet-4-6",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        runtimePolicyVersion: "RULE_SET_PREPARATION_SYSTEM@1.0",
        appliedMaxOutputTokens: 100,
        maximumExposureMicrocredits: 0n,
        initialExposureMicrocredits: 1n,
        capabilityDigest: "a".repeat(64),
        state: ADMISSION_STATES.SETTLED,
        expiresAt: new Date(Date.now() + 300_000),
        settledAt: new Date(),
        correlationId: `corr-${preparationRunId}`,
      },
    });
    await prisma.modelUsageReceipt.create({
      data: {
        admissionId,
        invocationId,
        providerCompletionState: "COMPLETED",
        operationType: "PREPARATION",
        runtimePolicyVersion: "RULE_SET_PREPARATION_SYSTEM@1.0",
        toolCallIds: ["call-a"],
        calculatedMicrocredits: 1n,
        debitedMicrocredits: 0n,
        chargedMicrocredits: 0n,
        settledAt: new Date(),
      },
    });
    await prisma.modelOutputEvaluation.create({
      data: {
        admissionId,
        invocationId,
        operationType: "PREPARATION",
        evaluationState: "NOT_EVALUATED",
        providerCompletionState: "COMPLETED",
        correlationId: `corr-${preparationRunId}`,
      },
    });
    // Why: A provider can reuse one tool-call ID in two legitimate physical responses.
    // How: Pin a second receipt to the same tool ID, then prove the journal's
    // physicalInvocationId selects only its matching admission.
    // Invariant: The shared tool ID alone never authorizes a verdict on another receipt.
    const otherAdmissionId = randomUUID();
    const otherInvocationId = randomUUID();
    await prisma.billableInvocationAdmission.create({
      data: {
        id: otherAdmissionId,
        invocationId: otherInvocationId,
        admissionRequestId: randomUUID(),
        requestFingerprint: "rejection-duplicate-tool-fixture",
        logicalOperationId: randomUUID(),
        attemptOrdinal: 1,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
        preparationRunId,
        runId: preparationRunId,
        agentRole: "rule-preparation",
        operationType: "PREPARATION",
        requestedModel: "claude-sonnet-4-6",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        runtimePolicyVersion: "RULE_SET_PREPARATION_SYSTEM@1.0",
        appliedMaxOutputTokens: 100,
        maximumExposureMicrocredits: 0n,
        initialExposureMicrocredits: 1n,
        capabilityDigest: "b".repeat(64),
        state: ADMISSION_STATES.SETTLED,
        expiresAt: new Date(Date.now() + 300_000),
        settledAt: new Date(),
        correlationId: `corr-${preparationRunId}`,
      },
    });
    await prisma.modelUsageReceipt.create({
      data: {
        admissionId: otherAdmissionId,
        invocationId: otherInvocationId,
        providerCompletionState: "COMPLETED",
        operationType: "PREPARATION",
        runtimePolicyVersion: "RULE_SET_PREPARATION_SYSTEM@1.0",
        toolCallIds: ["call-a"],
        calculatedMicrocredits: 1n,
        debitedMicrocredits: 0n,
        chargedMicrocredits: 0n,
        settledAt: new Date(),
      },
    });
    await prisma.modelOutputEvaluation.create({
      data: {
        admissionId: otherAdmissionId,
        invocationId: otherInvocationId,
        operationType: "PREPARATION",
        evaluationState: "NOT_EVALUATED",
        providerCompletionState: "COMPLETED",
        correlationId: `corr-${preparationRunId}`,
      },
    });

    const verdict = {
      admissionId,
      invocationId,
      preparationRunId,
      runId: preparationRunId,
      eventId,
      toolCallId: "call-a",
      rejectionCode: "CLAIM_IDENTITY_CONFLICT",
      evaluatorVersion: "rule-authoring-v1",
    };
    const unauthenticated = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .send(verdict);
    assert.equal(unauthenticated.status, 401);
    const forgedEvent = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({ ...verdict, eventId: randomUUID() });
    assert.equal(forgedEvent.status, 403);
    const wrongPhysicalReceipt = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        ...verdict,
        admissionId: otherAdmissionId,
        invocationId: otherInvocationId,
      });
    assert.equal(wrongPhysicalReceipt.status, 403);
    assert.equal(
      (
        await prisma.modelOutputEvaluation.findUnique({
          where: { invocationId: otherInvocationId },
        })
      )?.evaluationState,
      "NOT_EVALUATED",
    );
    assert.equal(
      (
        await prisma.modelOutputEvaluation.findUnique({
          where: { invocationId },
        })
      )?.evaluationState,
      "NOT_EVALUATED",
    );
    const decided = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(verdict);
    assert.equal(decided.status, 200);
    assert.equal(
      (
        await prisma.modelOutputEvaluation.findUnique({
          where: { invocationId },
        })
      )?.evaluationState,
      "DOMAIN_REJECTED",
    );
    const replay = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(verdict);
    assert.equal(replay.status, 200);
    const unrelated = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({ ...verdict, toolCallId: "call-not-in-receipt" });
    assert.ok(
      unrelated.status === 403 ||
        unrelated.status === 409 ||
        unrelated.status === 422,
    );
    assert.equal(
      (await prisma.modelUsageReceipt.findUnique({ where: { invocationId } }))
        ?.debitedMicrocredits,
      0n,
    );
    assert.equal(
      await prisma.auditEvent.count({
        where: {
          resourceId: admissionId,
          eventType: BILLING_AUDIT_EVENT_TYPES.outputDomainRejected,
        },
      }),
      1,
    );
    // Why: Worker event IDs are accepted metadata; a duplicate must not make DB row order authoritative.
    // How: Publish a second journal row carrying the same ID and retry the verdict callback.
    // Invariant: Ambiguous event evidence fails closed, including for a previously accepted callback.
    const duplicateEvent = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        preparation_run_id: preparationRunId,
        run_id: preparationRunId,
        event_type: "CUSTOM_PROGRESS",
        event_id: eventId,
        data: {
          activity_kind: "RULE_AUTHORING_TOOL_REJECTED",
          rejection: {
            toolCallId: "call-a",
            rejectionCode: "CLAIM_IDENTITY_CONFLICT",
          },
        },
      });
    assert.equal(duplicateEvent.status, 409);
    const ambiguous = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(verdict);
    assert.equal(ambiguous.status, 200);

    // Why: Worker event IDs are only unique within one run, while evaluatorEventId is global.
    // How: Reuse the same worker event ID in another run and assert the server journal IDs differ.
    // Invariant: Two legitimate physical invocations in separate runs can both receive a verdict.
    const secondRunId = `prep-causation-${randomUUID()}`;
    const secondAdmissionId = randomUUID();
    const secondInvocationId = randomUUID();
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: secondRunId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "RUNNING",
        correlationId: `corr-${secondRunId}`,
        idempotencyKey: `idem-${secondRunId}`,
      },
    });
    const secondPublished = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        preparation_run_id: secondRunId,
        run_id: secondRunId,
        event_type: "CUSTOM_PROGRESS",
        event_id: eventId,
        data: {
          activity_kind: "RULE_AUTHORING_TOOL_REJECTED",
          rejection: {
            toolCallId: "call-a",
            physicalInvocationId: secondInvocationId,
            rejectionCode: "CLAIM_IDENTITY_CONFLICT",
          },
        },
      });
    assert.equal(secondPublished.status, 202);
    await prisma.billableInvocationAdmission.create({
      data: {
        id: secondAdmissionId,
        invocationId: secondInvocationId,
        admissionRequestId: randomUUID(),
        requestFingerprint: "rejection-cross-run-fixture",
        logicalOperationId: randomUUID(),
        attemptOrdinal: 1,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
        preparationRunId: secondRunId,
        runId: secondRunId,
        agentRole: "rule-preparation",
        operationType: "PREPARATION",
        requestedModel: "claude-sonnet-4-6",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        runtimePolicyVersion: "RULE_SET_PREPARATION_SYSTEM@1.0",
        appliedMaxOutputTokens: 100,
        maximumExposureMicrocredits: 0n,
        initialExposureMicrocredits: 1n,
        capabilityDigest: "c".repeat(64),
        state: ADMISSION_STATES.SETTLED,
        expiresAt: new Date(Date.now() + 300_000),
        settledAt: new Date(),
        correlationId: `corr-${secondRunId}`,
      },
    });
    await prisma.modelUsageReceipt.create({
      data: {
        admissionId: secondAdmissionId,
        invocationId: secondInvocationId,
        providerCompletionState: "COMPLETED",
        operationType: "PREPARATION",
        runtimePolicyVersion: "RULE_SET_PREPARATION_SYSTEM@1.0",
        toolCallIds: ["call-a"],
        calculatedMicrocredits: 1n,
        debitedMicrocredits: 0n,
        chargedMicrocredits: 0n,
        settledAt: new Date(),
      },
    });
    await prisma.modelOutputEvaluation.create({
      data: {
        admissionId: secondAdmissionId,
        invocationId: secondInvocationId,
        operationType: "PREPARATION",
        evaluationState: "NOT_EVALUATED",
        providerCompletionState: "COMPLETED",
        correlationId: `corr-${secondRunId}`,
      },
    });
    const secondVerdict = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        ...verdict,
        admissionId: secondAdmissionId,
        invocationId: secondInvocationId,
        preparationRunId: secondRunId,
        runId: secondRunId,
      });
    assert.equal(secondVerdict.status, 200);
    const [firstEvaluation, secondEvaluation] = await Promise.all([
      prisma.modelOutputEvaluation.findUnique({ where: { invocationId } }),
      prisma.modelOutputEvaluation.findUnique({
        where: { invocationId: secondInvocationId },
      }),
    ]);
    assert.equal(secondEvaluation?.evaluationState, "DOMAIN_REJECTED");
    assert.notEqual(
      firstEvaluation?.evaluatorEventId,
      secondEvaluation?.evaluatorEventId,
    );
    // Why: Old or ambiguous worker events may identify a tool call but omit its physical invocation.
    // How: Publish that weaker evidence and verify it cannot mark the other receipt as rejected.
    // Invariant: Missing physical identity always leaves NOT_EVALUATED unchanged.
    const unboundEvent = await httpRequest(app)
      .post("/internal/assessment-runtime/agent-stream-events")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        preparation_run_id: preparationRunId,
        run_id: preparationRunId,
        event_type: "CUSTOM_PROGRESS",
        data: {
          activity_kind: "RULE_AUTHORING_TOOL_REJECTED",
          rejection: {
            toolCallId: "call-a",
            rejectionCode: "CLAIM_IDENTITY_CONFLICT",
          },
        },
      });
    assert.equal(unboundEvent.status, 202);
    const unboundVerdict = await httpRequest(app)
      .post("/internal/billing/output-evaluations/domain-rejected")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        ...verdict,
        admissionId: otherAdmissionId,
        invocationId: otherInvocationId,
        eventId: successBody<{ eventId: string }>(unboundEvent).eventId,
      });
    assert.equal(unboundVerdict.status, 403);
    assert.equal(
      (
        await prisma.modelOutputEvaluation.findUnique({
          where: { invocationId: otherInvocationId },
        })
      )?.evaluationState,
      "NOT_EVALUATED",
    );
  });

  it("rejects unauthenticated worker admission requests with HTTP 401", async () => {
    const payload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-auth-test-1",
      logicalOperationId: "op-auth-test-1",
      attemptOrdinal: 1,
      runId: "run-auth-test-1",
      assessmentId,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      outputTokensUpperBound: 4096,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .send(payload);

    assert.equal(res.status, 401, "Expected 401 without x-worker-api-key");
  });

  it("issues valid BillableInvocationAdmission for CUSTOMER_WALLET with bounded exposure", async () => {
    const payload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-customer-valid-1",
      logicalOperationId: "op-customer-valid-1",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 50_000,
      outputTokensUpperBound: 4096,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(payload);

    assert.equal(res.status, 201, "Expected 201 for valid admission request");
    const data = successBody<BillableInvocationAdmissionResponse>(res);
    assert.equal(
      data.fundingPrincipal,
      ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
    );
    assert.equal(data.state, ADMISSION_STATES.ADMITTED);
    assert.equal(data.rolloutMode, BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED);
    assert.equal(data.debitMode, MODEL_USAGE_DEBIT_MODES.OFF);
    assert.equal(data.tariffSnapshotId, publishedSnapshotId);
    assert.ok(data.capabilityToken && data.capabilityToken.length >= 32);

    // Verify DB record
    const dbAdmission = await prisma.billableInvocationAdmission.findUnique({
      where: { admissionRequestId: payload.admissionRequestId },
    });
    assert.ok(dbAdmission);
    assert.equal(dbAdmission.state, ADMISSION_STATES.ADMITTED);
    assert.equal(dbAdmission.walletId, customerWalletId);
    assert.equal(
      dbAdmission.capabilityDigest,
      deriveAdmissionCapabilityDigest(data.capabilityToken),
    );
    // Explicitly assert persistence decouples rolloutMode from debitMode OFF
    assert.equal(
      (dbAdmission as Record<string, unknown>).rolloutMode,
      BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
      "Persistence rolloutMode must be stored as BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED, not debit mode OFF",
    );
    assert.equal(
      (dbAdmission as Record<string, unknown>).debitMode,
      MODEL_USAGE_DEBIT_MODES.OFF,
      "Persistence debitMode must be stored as MODEL_USAGE_DEBIT_MODES.OFF",
    );
  });

  it("rejects customer admission when an allowlisted model has no active tariff", async () => {
    // Why: Worker tests simulate a missing-price response; this verifies the real server makes the same decision.
    // How: Remove the dedicated test assignment, then request admission for its otherwise valid model and lease.
    // Invariant: No capability or billable invocation may be issued without a published effective tariff.
    await prisma.customerModelTariffAssignment.delete({
      where: { id: publishedAssignmentId },
    });
    const payload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-customer-no-active-tariff",
      logicalOperationId: "op-customer-no-active-tariff",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 1000,
    };

    const response = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(payload);

    assert.equal(response.status, 422);
    assert.equal(
      problemBody(response).code,
      BILLING_ERROR_CODES.modelPricingNoCoverage,
    );
    assert.equal(
      await prisma.billableInvocationAdmission.count({
        where: { admissionRequestId: payload.admissionRequestId },
      }),
      0,
    );
  });

  it.each([
    {
      name: "cutover v2 wallet",
      accountingUnitVersion: 2,
      expectedStatus: 201,
    },
    { name: "legacy v1 wallet", accountingUnitVersion: 1, expectedStatus: 402 },
  ])(
    "uses the authoritative unit for $name with fractional positive balance",
    async ({ accountingUnitVersion, expectedStatus }) => {
      // Why: A cutover wallet can own half a credit while its legacy whole-credit projection is zero.
      // How: Pin the wallet version and compare admission against the relevant authoritative balance.
      // Invariant: A version-1 wallet cannot spend shadow microcredits before cutover.
      await prisma.billingWallet.update({
        where: { id: customerWalletId },
        data: {
          accountingUnitVersion,
          availableCredits: 0n,
          balanceMicrocredits: 500_000n,
        },
      });
      const res = await httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionRequestId: `req-fractional-${accountingUnitVersion}`,
          logicalOperationId: `op-fractional-${accountingUnitVersion}`,
          attemptOrdinal: 1,
          runId: defaultRunId,
          assessmentId,
          executionLeaseToken: defaultLeaseToken,
          agentRole: "assessment-root",
          operationType: "SYNTHESIS",
          requestedProvider: "anthropic",
          requestedModel: "claude-sonnet-4-6",
          inputTokensUpperBound: 100,
          outputTokensUpperBound: 100,
        });
      assert.equal(res.status, expectedStatus);
      if (expectedStatus === 201) {
        const admission = successBody<BillableInvocationAdmissionResponse>(res);
        const persisted =
          await prisma.billableInvocationAdmission.findUniqueOrThrow({
            where: { id: admission.admissionId },
          });
        assert.equal(persisted.walletId, customerWalletId);
      } else {
        assert.equal(
          problemBody(res).code,
          BILLING_ERROR_CODES.paymentRequired,
        );
      }
    },
  );

  it("G-04 RED: admitted exposure covers a permitted cache-write bucket priced above ordinary input", async () => {
    // Why: Admission currently prices the input bound only at the ordinary input rate, although a published tariff may charge cache writes at a higher rate.
    // How: Replace this test's active tariff interval with a cache-write tariff, then compare the admitted exposure with a valid all-cache-write invocation.
    // Invariant: Within declared token bounds, settlement must not exceed the amount admitted solely because a priced bucket was omitted from exposure.
    const now = new Date();
    const transition = new Date(now.getTime() - 30_000);
    await prisma.customerModelTariffAssignment.update({
      where: { id: publishedAssignmentId },
      data: { effectiveTo: transition },
    });
    const snapshot = await prisma.customerModelTariffSnapshot.create({
      data: {
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        version: 2,
        accountingUnitVersion: 1,
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cacheWriteMicrocreditsPerMillion: 20_000_000n,
        idempotencyKey: `publish-g04-cache-write-${randomUUID()}`,
        requestFingerprint: "b".repeat(64),
        publishedBy: "system-test",
        auditReason: "G-04 exposure regression fixture",
      },
    });
    await prisma.customerModelTariffAssignment.create({
      data: {
        tariffSnapshotId: snapshot.id,
        scope: MODEL_PRICING_SCOPES.exactModel,
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        effectiveFrom: transition,
        effectiveTo: null,
        createdBy: "system-test",
      },
    });

    const payload: BillableInvocationAdmissionRequest = {
      admissionRequestId: `req-g04-cache-write-${randomUUID()}`,
      logicalOperationId: `op-g04-cache-write-${randomUUID()}`,
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1_000,
      outputTokensUpperBound: 1,
    };
    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(payload);

    assert.equal(res.status, 201);
    const admission = successBody<BillableInvocationAdmissionResponse>(res);
    assert.equal(admission.tariffSnapshotId, snapshot.id);
    // 1,000 cache-write tokens * 20,000,000 per million plus one output token * 15,000,000 per million.
    assert.ok(
      BigInt(admission.initialExposureMicrocredits ?? "0") >= 20_015n,
      `Admitted ${admission.initialExposureMicrocredits} microcredits, but an in-bound cache-write call can cost 20,015`,
    );
  });

  it("rejects admission request with HTTP 402 PAYMENT_REQUIRED when customer wallet is insolvent", async () => {
    // Deplete customer wallet to 0
    await prisma.billingWallet.update({
      where: { id: customerWalletId },
      data: { availableCredits: 0n, balanceMicrocredits: 0n },
    });

    const payload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-insolvent-test-1",
      logicalOperationId: "op-insolvent-test-1",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(payload);

    assert.equal(res.status, 402, "Expected 402 for insolvent wallet");
    const problem = problemBody(res);
    assert.equal(problem.code, BILLING_ERROR_CODES.paymentRequired);
  });

  it("enforces per-wallet 1-slot concurrency limit: second active request is rejected with 429/409", async () => {
    // First admission
    const req1: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-slot-1",
      logicalOperationId: "op-slot-1",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const res1 = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(req1);
    assert.equal(res1.status, 201, "First admission should succeed");

    // Second admission for same wallet while first is still ADMITTED
    const req2: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-slot-2",
      logicalOperationId: "op-slot-2",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const res2 = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(req2);

    assert.ok(
      res2.status === 429 || res2.status === 409,
      `Expected 429 or 409 for slot limit, got ${res2.status}`,
    );
    const problem = problemBody(res2);
    assert.equal(
      problem.code,
      BILLING_ERROR_CODES.walletConcurrencyLimitExceeded,
    );
  });

  it("enforces slot blocking on unresolved states: OUTCOME_UNKNOWN and DISPATCH_UNKNOWN block new requests", async () => {
    // Seed an existing admission in OUTCOME_UNKNOWN under customer's wallet
    await prisma.billableInvocationAdmission.create({
      data: {
        invocationId: "inv-outcome-unknown-1",
        admissionRequestId: "req-outcome-unknown-1",
        requestFingerprint: "b".repeat(64),
        logicalOperationId: "op-unknown-1",
        attemptOrdinal: 1,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
        userId: customerUserId,
        walletId: customerWalletId,
        assessmentId,
        runId: "run-prior-unknown",
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedModel: "claude-sonnet-4-6",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        runtimePolicyVersion: "v1",
        rolloutMode: BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
        debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 5_000_000n,
        initialExposureMicrocredits: 5_000_000n,
        capabilityDigest: "c".repeat(64),
        state: ADMISSION_STATES.OUTCOME_UNKNOWN, // Unresolved state!
        admittedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 240_000),
        correlationId: "cid-unknown-test",
      },
    });

    // Attempt new admission request for same wallet
    const newReq: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-blocked-by-unknown",
      logicalOperationId: "op-new-1",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(newReq);

    assert.ok(
      res.status === 429 || res.status === 409,
      `Expected slot rejection when OUTCOME_UNKNOWN holds the slot, got ${res.status}`,
    );
    const problem = problemBody(res);
    assert.equal(
      problem.code,
      BILLING_ERROR_CODES.walletConcurrencyLimitExceeded,
    );
  });

  it("enforces concurrent race condition serialization under wallet row lock", async () => {
    const reqA: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-race-A",
      logicalOperationId: "op-race-A",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const reqB: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-race-B",
      logicalOperationId: "op-race-B",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    // Send two concurrent requests simultaneously with Promise.all()
    const [resA, resB] = await Promise.all([
      httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send(reqA),
      httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send(reqB),
    ]);

    const statuses = [resA.status, resB.status];
    assert.ok(
      statuses.includes(201),
      "Exactly one request must be admitted with 201",
    );
    assert.ok(
      statuses.includes(429) || statuses.includes(409),
      "The losing concurrent request must be rejected with 429/409",
    );
    assert.notEqual(
      resA.status,
      resB.status,
      "Both concurrent requests must not receive 201 simultaneously",
    );
  });

  it("performs atomic CAS ADMITTED -> IN_FLIGHT on valid capability token and rejects invalid token", async () => {
    // 1. Create admission
    const req: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-cas-test-1",
      logicalOperationId: "op-cas-test-1",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const admitRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(req);
    assert.equal(admitRes.status, 201);
    const admitData =
      successBody<BillableInvocationAdmissionResponse>(admitRes);

    // 2. Consume with invalid capability token -> rejected
    const badConsumeRes = await httpRequest(app)
      .post("/internal/billing/admission/consume")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admitData.admissionId,
        invocationId: admitData.invocationId,
        capabilityToken: "d".repeat(64), // Wrong token!
      });
    assert.equal(badConsumeRes.status, 422);
    const badProblem = problemBody(badConsumeRes);
    assert.equal(
      badProblem.code,
      BILLING_ERROR_CODES.admissionCapabilityMismatch,
    );

    // 3. Consume with correct capability token -> 200 IN_FLIGHT
    const goodConsumeRes = await httpRequest(app)
      .post("/internal/billing/admission/consume")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admitData.admissionId,
        invocationId: admitData.invocationId,
        capabilityToken: admitData.capabilityToken,
      });
    assert.equal(goodConsumeRes.status, 200);

    // Verify DB state is now IN_FLIGHT and consumedAt is recorded
    const updated = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admitData.admissionId },
    });
    assert.ok(updated);
    assert.equal(updated.state, ADMISSION_STATES.IN_FLIGHT);
    assert.ok(updated.consumedAt);
    assert.equal(updated.version, 2);
    assert.equal(
      (updated as Record<string, unknown>).rolloutMode,
      BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
    );
    assert.equal(
      (updated as Record<string, unknown>).debitMode,
      MODEL_USAGE_DEBIT_MODES.OFF,
    );
  });

  it("transitions unconsumed ADMITTED to EXPIRED with audit trail when TTL expires", async () => {
    const expiredCapToken = "f".repeat(64);
    const expiredCapDigest = deriveAdmissionCapabilityDigest(expiredCapToken);

    // Seed an expired ADMITTED record
    const expiredRecord = await prisma.billableInvocationAdmission.create({
      data: {
        invocationId: "inv-expired-ttl-1",
        admissionRequestId: "req-expired-ttl-1",
        requestFingerprint: "e".repeat(64),
        logicalOperationId: "op-expired-1",
        attemptOrdinal: 1,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
        userId: customerUserId,
        walletId: customerWalletId,
        assessmentId,
        runId: "run-expired-test",
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedModel: "claude-sonnet-4-6",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        runtimePolicyVersion: "v1",
        rolloutMode: BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
        debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 5_000_000n,
        initialExposureMicrocredits: 5_000_000n,
        capabilityDigest: expiredCapDigest,
        state: ADMISSION_STATES.ADMITTED,
        admittedAt: new Date(Date.now() - 400_000), // 400s ago
        expiresAt: new Date(Date.now() - 100_000), // Expired 100s ago!
        correlationId: "cid-expired-test",
      },
    });

    // Attempt consume on expired admission -> rejected with 422 admissionExpired
    const consumeRes = await httpRequest(app)
      .post("/internal/billing/admission/consume")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: expiredRecord.id,
        invocationId: expiredRecord.invocationId,
        capabilityToken: expiredCapToken,
      });
    assert.equal(consumeRes.status, 422);
    const problem = problemBody(consumeRes);
    assert.equal(problem.code, BILLING_ERROR_CODES.admissionExpired);

    // Verify DB state was transitioned to EXPIRED with version increment
    const transitioned = await prisma.billableInvocationAdmission.findUnique({
      where: { id: expiredRecord.id },
    });
    assert.ok(transitioned);
    assert.equal(transitioned.state, ADMISSION_STATES.EXPIRED);
    assert.equal(transitioned.version, 2);
  });

  it("enforces multi-factor idempotent replay: matching context returns existing admission; mismatched context or expired returns 409/410", async () => {
    const originalReq: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-replay-test-1",
      logicalOperationId: "op-replay-1",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    // 1. Initial request -> 201
    const res1 = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(originalReq);
    assert.equal(res1.status, 201);
    const data1 = successBody<BillableInvocationAdmissionResponse>(res1);

    // 2. Exact lost-response replay -> 200 with identical invocationId and capabilityToken
    const resReplay = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(originalReq);
    assert.equal(resReplay.status, 200);
    const dataReplay =
      successBody<BillableInvocationAdmissionResponse>(resReplay);
    assert.equal(dataReplay.invocationId, data1.invocationId);
    assert.equal(dataReplay.capabilityToken, data1.capabilityToken);

    // Verify DB record for replay has decoupled rolloutMode and debitMode OFF
    const dbReplay = await prisma.billableInvocationAdmission.findUnique({
      where: { admissionRequestId: originalReq.admissionRequestId },
    });
    assert.ok(dbReplay);
    assert.equal(
      (dbReplay as Record<string, unknown>).rolloutMode,
      BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
    );
    assert.equal(
      (dbReplay as Record<string, unknown>).debitMode,
      MODEL_USAGE_DEBIT_MODES.OFF,
    );

    // 3. Replay with same admissionRequestId but different payload/fingerprint -> 409 Conflict
    const resConflictFp = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        ...originalReq,
        requestedModel: "different-model", // Changed fingerprint!
      });
    assert.equal(resConflictFp.status, 409);
    const problemConflict = problemBody(resConflictFp);
    assert.equal(problemConflict.code, BILLING_ERROR_CODES.idempotencyConflict);

    // 4. Replay with same admissionRequestId but mismatched executionLeaseToken -> 403 / 409
    const resConflictLease = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        ...originalReq,
        executionLeaseToken: "different-unauthorized-lease",
      });
    assert.ok(
      resConflictLease.status === 403 || resConflictLease.status === 409,
      `Expected 403 or 409 for lease context mismatch, got ${resConflictLease.status}`,
    );
  });

  // =========================================================================
  // HARDENING TESTS (5 REQUESTED SAFETY INVARIANTS)
  // =========================================================================

  it("HARDENING-1: Server master secret isolation - rejects capability derivation with worker.apiKey", async () => {
    // Why: Capability HMAC tokens must be derived using a dedicated server master key (BILLING_ADMISSION_MASTER_KEY),
    // never WORKER_API_KEY which workers know and hold.
    // If derived with WORKER_API_KEY, the capability secret is compromised.
    // Seed an assessment runtime so context verification passes
    const leaseToken = "11111111-1111-1111-1111-111111111111";
    const runId = "22222222-2222-2222-2222-222222222222";
    await prisma.assessmentRuntime.upsert({
      where: { assessmentId },
      update: {
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
        currentExecutionId: runId,
      },
      create: {
        assessmentId,
        threadId: "00000000-0000-0000-0000-000000000001",
        rootAgentVersion: "1.0.0",
        checkpointNamespace: "test",
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
        currentExecutionId: runId,
        executionState: "RUNNING",
      },
    });

    const payload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-hmac-secret-test",
      logicalOperationId: "op-hmac-1",
      attemptOrdinal: 1,
      runId,
      assessmentId,
      executionLeaseToken: leaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 2000,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(payload);

    assert.equal(res.status, 201);
    const data = successBody<BillableInvocationAdmissionResponse>(res);

    // Capability token derived by worker using its own WORKER_API_KEY MUST NOT match the server-issued token!
    const workerForgedToken = deriveAdmissionCapabilitySecret(
      WORKER_TEST_API_KEY,
      payload.admissionRequestId,
      computeAdmissionRequestFingerprint(payload),
      data.invocationId,
    );
    assert.notEqual(
      data.capabilityToken,
      workerForgedToken,
      "Server capability token MUST NOT be derived from WORKER_API_KEY; must use dedicated server master secret!",
    );
  });

  it("HARDENING-2: Context & Authority Verification - rejects mismatched or expired execution lease with HTTP 403", async () => {
    // Why: An admission request for an assessment must prove possession of an active, unexpired lease token for that assessment.
    // 1. Seed AssessmentRuntime with valid UUID leaseToken and currentExecutionId
    const validLease = "33333333-3333-3333-3333-333333333333";
    const validRun = "44444444-4444-4444-4444-444444444444";
    await prisma.assessmentRuntime.upsert({
      where: { assessmentId },
      update: {
        leaseToken: validLease,
        leaseExpiresAt: new Date(Date.now() + 3600_000), // Valid for 1h
        currentExecutionId: validRun,
      },
      create: {
        assessmentId,
        threadId: "00000000-0000-0000-0000-000000000002",
        rootAgentVersion: "1.0.0",
        checkpointNamespace: "test",
        leaseToken: validLease,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
        currentExecutionId: validRun,
        executionState: "RUNNING",
      },
    });

    // 2. Request admission with INVALID lease token -> must return 403 admissionContextMismatch
    const invalidLeasePayload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-invalid-lease-1",
      logicalOperationId: "op-lease-1",
      attemptOrdinal: 1,
      runId: validRun,
      assessmentId,
      executionLeaseToken: "99999999-9999-9999-9999-999999999999", // Mismatched lease!
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 2000,
    };

    const resInvalidLease = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(invalidLeasePayload);

    assert.equal(
      resInvalidLease.status,
      403,
      "Expected HTTP 403 when executionLeaseToken does not match active AssessmentRuntime lease",
    );
    const problem = problemBody(resInvalidLease);
    assert.equal(problem.code, BILLING_ERROR_CODES.admissionContextMismatch);
  });

  it("HARDENING-2B: Platform Sponsorship Policy - rejects arbitrary requests without assessmentId or approved policy", async () => {
    // Why: Server must NEVER blindly grant PLATFORM_SPONSORED when assessmentId is missing.
    // Sponsorship is restricted to approved policies (e.g. RuleSetPreparationRun with requestedBy === 'SYSTEM').
    const unapprovedPayload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-unapproved-sponsor-1",
      logicalOperationId: "op-unapproved-1",
      attemptOrdinal: 1,
      runId: "55555555-5555-5555-5555-555555555555",
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 2000,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(unapprovedPayload);

    assert.equal(
      res.status,
      403,
      "Expected HTTP 403 for arbitrary request without assessmentId or approved sponsorship policy",
    );
    const problem = problemBody(res);
    assert.equal(problem.code, BILLING_ERROR_CODES.admissionContextMismatch);
  });

  it("HARDENING-3: Mandatory Token Bounds - rejects missing or non-positive bounds with HTTP 422", async () => {
    // Why: Token bounds define financial exposure. Omitting bounds must be rejected with 422,
    // never defaulted to a synthetic 5,000,000n microcredits.
    const leaseToken = "66666666-6666-6666-6666-666666666666";
    const runId = "77777777-7777-7777-7777-777777777777";
    await prisma.assessmentRuntime.upsert({
      where: { assessmentId },
      update: {
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
        currentExecutionId: runId,
      },
      create: {
        assessmentId,
        threadId: "00000000-0000-0000-0000-000000000003",
        rootAgentVersion: "1.0.0",
        checkpointNamespace: "test",
        leaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
        currentExecutionId: runId,
        executionState: "RUNNING",
      },
    });

    const missingBoundsPayload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-missing-bounds-1",
      logicalOperationId: "op-bounds-1",
      attemptOrdinal: 1,
      runId,
      assessmentId,
      executionLeaseToken: leaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      // inputTokensUpperBound and outputTokensUpperBound are omitted!
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(missingBoundsPayload);

    assert.equal(
      res.status,
      422,
      "Expected HTTP 422 when inputTokensUpperBound or outputTokensUpperBound are omitted",
    );
    const problem = problemBody(res);
    assert.equal(problem.code, BILLING_ERROR_CODES.validationFailed);
  });

  it("HARDENING-4: IN_FLIGHT Exemption from TTL - allows recovery of IN_FLIGHT invocation even after TTL passes", async () => {
    // Why: Per ADR-028, TTL (e.g. 300s) applies ONLY to unconsumed ADMITTED admissions.
    // An admission already transitioned to IN_FLIGHT must NOT be rejected by consume recovery after 5 minutes.
    const admissionId = `adm-inflight-past-ttl-${Date.now()}`;
    const invocationId = `inv-inflight-past-ttl-${Date.now()}`;
    const capabilityToken = "valid-cap-token-" + "c".repeat(32);
    const capabilityDigest = deriveAdmissionCapabilityDigest(capabilityToken);

    // Create an admission in IN_FLIGHT state with expiresAt 10 minutes in the past
    const tenMinutesAgo = new Date(Date.now() - 600_000);
    await prisma.billableInvocationAdmission.create({
      data: {
        id: admissionId,
        invocationId,
        admissionRequestId: `req-${admissionId}`,
        requestFingerprint: "fingerprint-inflight-1",
        logicalOperationId: "op-inflight-1",
        attemptOrdinal: 1,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
        userId: customerUserId,
        walletId: customerWalletId,
        assessmentId,
        runId: "run-inflight-1",
        executionLeaseToken: "lease-inflight-1",
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedModel: "claude-sonnet-4-6",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        tariffSnapshotId: publishedSnapshotId,
        tariffAssignmentId: publishedAssignmentId,
        pricingResolution: MODEL_PRICING_SCOPES.exactModel,
        runtimePolicyVersion: "1.0",
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 61_440_000n,
        initialExposureMicrocredits: 61_440_000n,
        capabilityDigest,
        state: ADMISSION_STATES.IN_FLIGHT,
        version: 2,
        admittedAt: new Date(Date.now() - 700_000),
        expiresAt: tenMinutesAgo, // Past TTL!
        consumedAt: new Date(Date.now() - 650_000),
        correlationId: "corr-inflight-ttl",
      },
    });

    // Worker calls consume on this IN_FLIGHT admission for recovery
    const res = await httpRequest(app)
      .post("/internal/billing/admission/consume")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId,
        invocationId,
        capabilityToken,
      });

    assert.equal(
      res.status,
      200,
      "IN_FLIGHT admission MUST return 200 idempotent recovery even if expiresAt has passed",
    );
    const data = successBody<{ state: string }>(res);
    assert.equal(data.state, ADMISSION_STATES.IN_FLIGHT);
  });

  it("rejects PLATFORM_SPONSORED call with HTTP 403 when no approved PlatformSponsorshipPolicySnapshot exists (fail closed)", async () => {
    // 1. Seed a RuleSetPreparationRun with requestedBy: "SYSTEM"
    const source = await prisma.legalSourceVersion.create({
      data: {
        version: `sys-src-failclosed-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const prepRunId = `prep-sys-failclosed-${randomUUID()}`;
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: prepRunId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "RUNNING",
        correlationId: `corr-${prepRunId}`,
        idempotencyKey: `idem-${prepRunId}`,
      },
    });

    const req: BillableInvocationAdmissionRequest = {
      admissionRequestId: `req-sponsored-unapproved-${randomUUID()}`,
      logicalOperationId: "op-prep-failclosed-1",
      attemptOrdinal: 1,
      runId: prepRunId,
      preparationRunId: prepRunId,
      agentRole: "rule-preparation",
      operationType: "PREPARATION",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    // Why: ADR-028 & AD-07: Platform sponsorship requires an approved, active PlatformSponsorshipPolicySnapshot.
    // Mechanism: If no active policy snapshot exists for the provider and model, admission MUST fail closed with 403.
    // Invariants: Server authority must NEVER fallback to customer tariff or admit unbacked platform work.
    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(req);

    assert.equal(
      res.status,
      403,
      `Expected 403 Forbidden for platform sponsored call without approved sponsorship policy, got ${res.status}`,
    );
    const problem = problemBody(res);
    assert.equal(
      problem.code,
      BILLING_ERROR_CODES.admissionContextMismatch,
      "Expected admissionContextMismatch for unapproved platform sponsorship request",
    );
  });

  it("admits PLATFORM_SPONSORED call using pinned PlatformSponsorshipPolicySnapshot rates, not customer tariff", async () => {
    // 1. Seed an approved PlatformSponsorshipPolicySnapshot with distinct platform rates
    const policySnapshot =
      await prisma.platformSponsorshipPolicySnapshot.create({
        data: {
          policyName: "RULE_SET_PREPARATION_SYSTEM",
          policyVersion: "1.0",
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          description:
            "Authoritative platform sponsorship policy for system rule preparation",
          inputMicrocreditsPerMillion: 15_000_000n,
          outputMicrocreditsPerMillion: 45_000_000n,
          effectiveFrom: new Date(Date.now() - 3600_000),
        },
      });

    // 2. Seed a RuleSetPreparationRun with requestedBy: "SYSTEM"
    const source = await prisma.legalSourceVersion.create({
      data: { version: `sys-src-approved-${randomUUID()}`, sourceManifest: {} },
    });
    const prepRunId = `prep-sys-approved-${randomUUID()}`;
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: prepRunId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "RUNNING",
        correlationId: `corr-${prepRunId}`,
        idempotencyKey: `idem-${prepRunId}`,
      },
    });

    const req: BillableInvocationAdmissionRequest = {
      admissionRequestId: `req-sponsored-approved-${randomUUID()}`,
      logicalOperationId: "op-prep-approved-1",
      attemptOrdinal: 1,
      runId: prepRunId,
      preparationRunId: prepRunId,
      agentRole: "rule-preparation",
      operationType: "PREPARATION",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(req);

    assert.equal(
      res.status,
      201,
      `Expected 201 Created for platform sponsored admission, got ${res.status}`,
    );
    const data = successBody<BillableInvocationAdmissionResponse>(res);
    assert.equal(
      data.fundingPrincipal,
      ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
    );

    // Invariant: Customer tariff fields MUST be null for platform-sponsored calls
    assert.equal(data.tariffSnapshotId, null);
    assert.equal(data.tariffAssignmentId, null);
    assert.equal(data.sponsorshipPolicySnapshotId, policySnapshot.id);

    // Expected exposure based on policy snapshot rates (15M in, 45M out):
    // (1000 * 15_000_000 + 4096 * 45_000_000 + 999_999) / 1_000_000 = 199_320n
    const expectedExposureMicrocredits = 199_320n;
    assert.equal(
      BigInt(data.maximumExposureMicrocredits),
      expectedExposureMicrocredits,
      `Expected maximumExposureMicrocredits to be calculated from policy rates (${expectedExposureMicrocredits}), got ${data.maximumExposureMicrocredits}`,
    );

    // Verify DB record
    const dbRecord = await prisma.billableInvocationAdmission.findUnique({
      where: { id: data.admissionId },
    });
    assert.ok(dbRecord);
    assert.equal(dbRecord.walletId, null);
    assert.equal(dbRecord.userId, null);
    assert.equal(dbRecord.tariffSnapshotId, null);
    assert.equal(dbRecord.tariffAssignmentId, null);
    assert.equal(dbRecord.sponsorshipPolicySnapshotId, policySnapshot.id);
    assert.equal(
      dbRecord.maximumExposureMicrocredits,
      expectedExposureMicrocredits,
    );
    assert.equal(
      dbRecord.runtimePolicyVersion,
      "RULE_SET_PREPARATION_SYSTEM@1.0",
    );
  });

  it("enforces immutability on PlatformSponsorshipPolicySnapshot (rejects UPDATE and DELETE)", async () => {
    // 1. Seed a snapshot
    const policySnapshot =
      await prisma.platformSponsorshipPolicySnapshot.create({
        data: {
          policyName: `IMMUTABLE_TEST_${randomUUID().slice(0, 8)}`,
          policyVersion: "1.0",
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
          description: "Immutable snapshot test",
          inputMicrocreditsPerMillion: 10_000_000n,
          outputMicrocreditsPerMillion: 30_000_000n,
          effectiveFrom: new Date(),
        },
      });

    // 2. Attempt UPDATE -> must be rejected by PostgreSQL trigger
    await assert.rejects(
      async () => {
        await prisma.platformSponsorshipPolicySnapshot.update({
          where: { id: policySnapshot.id },
          data: { description: "Mutated description" },
        });
      },
      (err: Error) => {
        assert.match(
          err.message,
          /PlatformSponsorshipPolicySnapshot rows are append-only/i,
        );
        return true;
      },
      "Expected PostgreSQL trigger to prevent UPDATE on PlatformSponsorshipPolicySnapshot",
    );

    // 3. Attempt DELETE -> must be rejected by PostgreSQL trigger
    await assert.rejects(
      async () => {
        await prisma.platformSponsorshipPolicySnapshot.delete({
          where: { id: policySnapshot.id },
        });
      },
      (err: Error) => {
        assert.match(
          err.message,
          /PlatformSponsorshipPolicySnapshot rows are append-only/i,
        );
        return true;
      },
      "Expected PostgreSQL trigger to prevent DELETE on PlatformSponsorshipPolicySnapshot",
    );
  });

  it("enforces non-overlapping validity intervals on PlatformSponsorshipPolicySnapshot via GiST exclusion constraint", async () => {
    const sharedPolicyName = `NO_OVERLAP_${randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // 1. Seed policy A with interval [now - 2 hours, now + 1 hour)
    await prisma.platformSponsorshipPolicySnapshot.create({
      data: {
        policyName: sharedPolicyName,
        policyVersion: "1.0",
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        description: "Initial sponsorship policy snapshot",
        inputMicrocreditsPerMillion: 12_000_000n,
        outputMicrocreditsPerMillion: 36_000_000n,
        effectiveFrom: new Date(now - 7200_000),
        effectiveTo: new Date(now + 3600_000),
      },
    });

    // 2. Attempt to seed policy B with an overlapping interval [now, now + 2 hours) for the SAME scope
    // Why: ADR-028 & Root Cause: At any given point in time, there MUST be at most one authoritative
    // policy snapshot for a given (policyName, provider, resolvedModel). Overlapping intervals create ambiguity.
    // Mechanism: PostgreSQL btree_gist EXCLUDE USING gist constraint prevents overlapping half-open intervals [effectiveFrom, effectiveTo).
    // Invariants: Database rejects overlapping policies with exclusion constraint error.
    await assert.rejects(
      async () => {
        await prisma.platformSponsorshipPolicySnapshot.create({
          data: {
            policyName: sharedPolicyName,
            policyVersion: "2.0",
            provider: "anthropic",
            resolvedModel: "claude-sonnet-4-6",
            description: "Overlapping sponsorship policy snapshot",
            inputMicrocreditsPerMillion: 14_000_000n,
            outputMicrocreditsPerMillion: 42_000_000n,
            effectiveFrom: new Date(now), // Overlaps with Policy A!
            effectiveTo: new Date(now + 7200_000),
          },
        });
      },
      (err: Error) => {
        assert.match(
          err.message,
          /exclusion constraint|PlatformSponsorshipPolicySnapshot_no_overlap/i,
        );
        return true;
      },
      "Expected PostgreSQL EXCLUDE constraint to reject overlapping PlatformSponsorshipPolicySnapshot intervals",
    );
  });

  it("commits EXPIRED state to PostgreSQL on unconsumed expired replay before returning 422", async () => {
    // 1. Seed an unconsumed admission with state ADMITTED but expiresAt in the past
    const expiredReqId = `req-exp-replay-${randomUUID()}`;
    const invocationId = `inv-exp-${randomUUID()}`;
    const pastDate = new Date(Date.now() - 60_000); // 1 minute ago

    const reqPayload: BillableInvocationAdmissionRequest = {
      admissionRequestId: expiredReqId,
      logicalOperationId: "op-exp-1",
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };
    const fingerprint = computeAdmissionRequestFingerprint(reqPayload);

    const expiredAdmission = await prisma.billableInvocationAdmission.create({
      data: {
        admissionRequestId: expiredReqId,
        invocationId,
        requestFingerprint: fingerprint,
        logicalOperationId: reqPayload.logicalOperationId,
        attemptOrdinal: 1,
        fundingPrincipal: ADMISSION_FUNDING_PRINCIPALS.CUSTOMER_WALLET,
        userId: customerUserId,
        walletId: customerWalletId,
        assessmentId,
        runId: defaultRunId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedModel: "claude-sonnet-4-6",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        tariffSnapshotId: publishedSnapshotId,
        tariffAssignmentId: publishedAssignmentId,
        pricingResolution: MODEL_PRICING_SCOPES.exactModel,
        runtimePolicyVersion: "WP8_PILOT_V1",
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 61_440_000n,
        initialExposureMicrocredits: 61_440_000n,
        capabilityDigest: "digest-" + "e".repeat(32),
        state: ADMISSION_STATES.ADMITTED,
        admittedAt: new Date(Date.now() - 360_000),
        expiresAt: pastDate,
        correlationId: "corr-exp-test",
      },
    });

    // 2. Replay the expired admission request
    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(reqPayload);

    // Invariant: Must return 422 admissionExpired
    assert.equal(res.status, 422);
    const problem = problemBody(res);
    assert.equal(problem.code, BILLING_ERROR_CODES.admissionExpired);

    // Invariant: The EXPIRED state transition MUST NOT be rolled back by transaction abort
    const dbRecord = await prisma.billableInvocationAdmission.findUnique({
      where: { id: expiredAdmission.id },
    });
    assert.ok(dbRecord);
    assert.equal(
      dbRecord.state,
      ADMISSION_STATES.EXPIRED,
      "PostgreSQL record MUST be committed as EXPIRED even though the HTTP response was an error (422)",
    );
  });

  it("Middleware-to-API Integration (G-06): UsageMeteringMiddleware and WorkerApiClient drive server admission and consume against live NestJS API on Postgres test DB", async () => {
    // 1. Ensure ephemeral port is open and server is listening
    const port = listeningPort(app);
    assert.ok(port > 0, "Server must be listening on an ephemeral port");
    const apiBaseUrl = `http://127.0.0.1:${port}`;

    // 2. Setup DB fixtures on disposable Postgres test DB
    const source = await prisma.legalSourceVersion.create({
      data: {
        version: `sys-src-worker-integ-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const prepRunId = `prep-run-worker-integ-${randomUUID()}`;
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: prepRunId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "RUNNING",
        correlationId: `corr-${prepRunId}`,
        idempotencyKey: `idem-${prepRunId}`,
      },
    });

    const activePolicy = await prisma.platformSponsorshipPolicySnapshot.create({
      data: {
        policyName: "RULE_SET_PREPARATION_SYSTEM",
        policyVersion: `WP8_PREPARATION_${randomUUID()}`,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        effectiveFrom: new Date(Date.now() - 3600_000),
        effectiveTo: null,
      },
    });

    // 3. Execute python runner invoking WorkerApiClient and UsageMeteringMiddleware with real HTTP
    const pythonScript = `
import asyncio
import json
import sys
from middleware.usage_metering import UsageMeteringMiddleware, AgentRunState, activate_agent_run_state
from tools.common.capabilities.platform.api_client import WorkerApiClient
from test_selected_rule_preparation import GovernedSelectedFixtureModel
from langchain_core.messages import HumanMessage

base_url = sys.argv[1]
worker_key = sys.argv[2]
prep_run_id = sys.argv[3]

client = WorkerApiClient(base_url, worker_key)
model = GovernedSelectedFixtureModel()
middleware = UsageMeteringMiddleware()

state = AgentRunState(
    run_id=prep_run_id,
    preparation_run_id=prep_run_id,
    agent_role="rule-set-preparation",
    api_client=client,
)

class Req:
    def __init__(self, m):
        self.model = m
        self.messages = [HumanMessage(content="test rule")]
        self.preparation_run_id = prep_run_id
        self.logical_operation_id = "op-worker-integ-1"

async def run():
    with activate_agent_run_state(state):
        req = Req(model)
        resp = await middleware.awrap_model_call(req, lambda r: model.ainvoke(r.messages))
        return resp

resp = asyncio.run(run())
print(json.dumps({"success": True, "calls": len(model.calls)}))
`;

    const repoRoot = resolve(apiRoot, "../..");
    const pythonBin = resolve(repoRoot, "deepagents/.venv/bin/python");

    const { stdout } = await execFileAsync(
      pythonBin,
      ["-c", pythonScript, apiBaseUrl, WORKER_TEST_API_KEY, prepRunId],
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

    const lastJsonLine =
      stdout
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .pop() ?? "{}";
    console.log("FULL SOURCE STDOUT:", stdout);
    const parsed = pythonResult(lastJsonLine);
    assert.equal(parsed.success, true);
    assert.equal(parsed.calls, 1, "Model must have been called exactly once");

    // 4. Verify DB state in PostgreSQL: BillableInvocationAdmission was created and consumed to IN_FLIGHT
    const admission = await prisma.billableInvocationAdmission.findFirst({
      where: { preparationRunId: prepRunId },
    });
    assert.ok(admission, "Admission record must exist in PostgreSQL");
    assert.equal(
      admission.fundingPrincipal,
      ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
    );
    assert.ok(
      admission.state === ADMISSION_STATES.IN_FLIGHT ||
        admission.state === ADMISSION_STATES.OUTCOME_UNKNOWN ||
        admission.state === ADMISSION_STATES.SETTLED,
      "Admission must be transitioned to IN_FLIGHT, OUTCOME_UNKNOWN, or SETTLED by worker execution",
    );
    assert.equal(admission.sponsorshipPolicySnapshotId, activePolicy.id);
    assert.equal(admission.requestedModel, "claude-sonnet-4-6");
    assert.ok(admission.consumedAt !== null, "consumedAt must be stamped");
  });

  it("Middleware-to-API Integration (G-06 Fail-Closed): WorkerApiClient fails closed with HTTP 404 when preparationRunId is not found on server", async () => {
    const port = listeningPort(app);
    const apiBaseUrl = `http://127.0.0.1:${port}`;

    // Non-existent preparationRunId in DB: Server must return HTTP 404 NOT_FOUND per line 282
    const unapprovedPrepRunId = `unapproved-run-${randomUUID()}`;

    const pythonScript = `
import asyncio
import json
import sys
from middleware.usage_metering import UsageMeteringMiddleware, PaidAdmissionError, AgentRunState, activate_agent_run_state
from tools.common.capabilities.platform.api_client import WorkerApiClient, WorkerCallbackError
from test_selected_rule_preparation import GovernedSelectedFixtureModel
from langchain_core.messages import HumanMessage

base_url = sys.argv[1]
worker_key = sys.argv[2]
prep_run_id = sys.argv[3]

client = WorkerApiClient(base_url, worker_key)
model = GovernedSelectedFixtureModel()
middleware = UsageMeteringMiddleware()

state = AgentRunState(
    run_id=prep_run_id,
    preparation_run_id=prep_run_id,
    agent_role="rule-set-preparation",
    api_client=client,
)

class Req:
    def __init__(self, m):
        self.model = m
        self.messages = [HumanMessage(content="test rule")]
        self.preparation_run_id = prep_run_id
        self.logical_operation_id = "op-worker-failclosed-1"

async def run():
    with activate_agent_run_state(state):
        req = Req(model)
        try:
            resp = await middleware.awrap_model_call(req, lambda r: model.ainvoke(r.messages))
            return {"denied": False, "calls": len(model.calls)}
        except WorkerCallbackError as e:
            return {
                "denied": True,
                "error": type(e).__name__,
                "statusCode": getattr(e, "status_code", None),
                "message": str(e),
                "calls": len(model.calls),
            }
        except PaidAdmissionError as e:
            return {
                "denied": True,
                "error": type(e).__name__,
                "statusCode": None,
                "message": str(e),
                "calls": len(model.calls),
            }

res = asyncio.run(run())
print(json.dumps(res))
`;

    const repoRoot = resolve(apiRoot, "../..");
    const pythonBin = resolve(repoRoot, "deepagents/.venv/bin/python");

    const { stdout } = await execFileAsync(
      pythonBin,
      [
        "-c",
        pythonScript,
        apiBaseUrl,
        WORKER_TEST_API_KEY,
        unapprovedPrepRunId,
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

    const lastJsonLine =
      stdout
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .pop() ?? "{}";
    const parsed = pythonResult(lastJsonLine);
    assert.equal(parsed.denied, true, "Must have been denied by server");
    assert.equal(
      parsed.statusCode,
      404,
      "Server must return HTTP 404 NOT_FOUND for non-existent preparationRunId",
    );
    assert.ok(
      typeof parsed.message === "string" && parsed.message.includes("404"),
      "Error message must indicate HTTP 404",
    );
    assert.equal(
      parsed.calls,
      0,
      "Zero provider calls when admission is denied",
    );

    // Confirm no admission record exists
    const admission = await prisma.billableInvocationAdmission.findFirst({
      where: { preparationRunId: unapprovedPrepRunId },
    });
    assert.equal(
      admission,
      null,
      "No admission record must be created for unapproved run",
    );
  });

  it("HARDENING-G04-1: rejects non-positive token bounds (upper bound = 0) with HTTP 422 before admission", async () => {
    const payload = {
      admissionRequestId: `adm-zero-bound-${randomUUID()}`,
      logicalOperationId: `op-zero-bound-${randomUUID()}`,
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 0, // Bound = 0 must reject
      outputTokensUpperBound: 1000,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(payload);

    assert.equal(res.status, 422, "Must reject with HTTP 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.validationFailed);

    const admission = await prisma.billableInvocationAdmission.findFirst({
      where: { admissionRequestId: payload.admissionRequestId },
    });
    assert.equal(
      admission,
      null,
      "Zero admissions created on boundary rejection",
    );
  });

  it("HARDENING-G04-2: initialExposureMicrocredits is mandatory on insert and strictly immutable at database tier (rejects UPDATE including NULL -> value)", async () => {
    // 1. Issuing admission records initialExposureMicrocredits matching maximumExposureMicrocredits
    const validPayload = {
      admissionRequestId: `adm-immut-snap-${randomUUID()}`,
      logicalOperationId: `op-immut-snap-${randomUUID()}`,
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 2000,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(validPayload);
    assert.equal(res.status, 201);

    const [row] = await prisma.$queryRaw<
      Array<{
        id: string;
        initialExposureMicrocredits: bigint | null;
        maximumExposureMicrocredits: bigint;
      }>
    >`
      SELECT id, "initialExposureMicrocredits", "maximumExposureMicrocredits"
      FROM "BillableInvocationAdmission"
      WHERE "admissionRequestId" = ${validPayload.admissionRequestId}
    `;
    assert.ok(row, "Admission row must exist");
    assert.ok(
      row.initialExposureMicrocredits !== null,
      "initialExposureMicrocredits must be populated on insert",
    );
    assert.equal(
      row.initialExposureMicrocredits,
      row.maximumExposureMicrocredits,
      "initialExposureMicrocredits must match approved maximumExposureMicrocredits",
    );

    // 2. Database tier rejects direct INSERT with NULL initialExposureMicrocredits
    const invalidId = randomUUID();
    await assert.rejects(
      async () => {
        await prisma.$executeRaw`
          INSERT INTO "BillableInvocationAdmission" (
            id, "invocationId", "admissionRequestId", "requestFingerprint", "logicalOperationId",
            "attemptOrdinal", "fundingPrincipal", "runId", "agentRole", "operationType",
            "requestedModel", "resolvedProvider", "resolvedModel", "runtimePolicyVersion",
            "appliedMaxOutputTokens", "maximumExposureMicrocredits", "capabilityDigest",
            "expiresAt", "correlationId", "initialExposureMicrocredits", "updatedAt"
          ) VALUES (
            ${invalidId}, ${"inv-" + invalidId}, ${"adm-req-" + invalidId}, 'fp-inv', ${"op-" + invalidId},
            1, 'PLATFORM_SPONSORED', 'run-inv', 'rule-set-preparation', 'PREPARATION',
            'claude-sonnet-4-6', 'anthropic', 'claude-sonnet-4-6', 'WP8_TEST',
            1000, 0, 'digest-inv', NOW() + INTERVAL '1 hour', 'corr-inv', NULL, NOW()
          )
        `;
      },
      /initialExposureMicrocredits is mandatory on insert/,
      "Database trigger MUST reject any new INSERT lacking initialExposureMicrocredits",
    );

    // 3. Database tier rejects direct UPDATE mutating initialExposureMicrocredits
    await assert.rejects(
      async () => {
        await prisma.$executeRaw`
          UPDATE "BillableInvocationAdmission"
          SET "initialExposureMicrocredits" = 999999
          WHERE id = ${row.id}
        `;
      },
      /initialExposureMicrocredits is immutable/,
      "Database trigger MUST reject any modification to initialExposureMicrocredits",
    );

    // 4. Database tier rejects mutating NULL -> value for historical records
    const histId = randomUUID();
    try {
      await prisma.$executeRaw`ALTER TABLE "BillableInvocationAdmission" DISABLE TRIGGER "BillableInvocationAdmission_initial_exposure_insert";`;
      await prisma.$executeRaw`
        INSERT INTO "BillableInvocationAdmission" (
          id, "invocationId", "admissionRequestId", "requestFingerprint", "logicalOperationId",
          "attemptOrdinal", "fundingPrincipal", "runId", "agentRole", "operationType",
          "requestedModel", "resolvedProvider", "resolvedModel", "runtimePolicyVersion",
          "appliedMaxOutputTokens", "maximumExposureMicrocredits", "capabilityDigest",
          "expiresAt", "correlationId", "initialExposureMicrocredits", "updatedAt"
        ) VALUES (
          ${histId}, ${"inv-" + histId}, ${"adm-req-" + histId}, 'fp-hist', ${"op-" + histId},
          1, 'PLATFORM_SPONSORED', 'run-hist', 'rule-set-preparation', 'PREPARATION',
          'claude-sonnet-4-6', 'anthropic', 'claude-sonnet-4-6', 'WP8_HIST',
          1000, 0, 'digest-hist', NOW() + INTERVAL '1 hour', 'corr-hist', NULL, NOW()
        )
      `;
    } finally {
      await prisma.$executeRaw`ALTER TABLE "BillableInvocationAdmission" ENABLE TRIGGER "BillableInvocationAdmission_initial_exposure_insert";`;
    }

    await assert.rejects(
      async () => {
        await prisma.$executeRaw`
          UPDATE "BillableInvocationAdmission"
          SET "initialExposureMicrocredits" = 500000
          WHERE id = ${histId}
        `;
      },
      /initialExposureMicrocredits is immutable/,
      "Database trigger MUST reject mutating historical NULL to a fabricated number",
    );
  });

  it("HARDENING-G04-3: replay of historical admission lacking snapshot preserves null and does not fabricate 0", async () => {
    // Rationale ("Why"): Historical admissions closed before migration 20261127090000 have initialExposureMicrocredits = NULL
    // and maximumExposureMicrocredits = 0. Replaying them must preserve the explicit absence of initial snapshot (null)
    // rather than fabricating "0" as if the initial exposure was zero.
    // Mechanism ("How"): Insert historical record with NULL snapshot, execute exact idempotent replay request, and assert initialExposureMicrocredits is null.
    // Invariants: Does not corrupt audit trail by fabricating historical values.
    const histAdmissionId = `adm-hist-null-${randomUUID()}`;
    const histInvocationId = `inv-hist-null-${randomUUID()}`;
    const histReqId = `req-hist-null-${randomUUID()}`;
    const histLogicalOpId = `op-hist-null-${randomUUID()}`;

    const replayReq: BillableInvocationAdmissionRequest = {
      admissionRequestId: histReqId,
      logicalOperationId: histLogicalOpId,
      attemptOrdinal: 1,
      runId: defaultRunId,
      assessmentId,
      executionLeaseToken: defaultLeaseToken,
      agentRole: "assessment-root",
      operationType: "SYNTHESIS",
      requestedProvider: "anthropic",
      requestedModel: "claude-sonnet-4-6",
      inputTokensUpperBound: 1000,
      outputTokensUpperBound: 4096,
    };

    const fingerprint = computeAdmissionRequestFingerprint(replayReq);

    // Disable trigger to insert historical legacy record with NULL initialExposureMicrocredits and maximumExposureMicrocredits = 0 (closed)
    await prisma.$executeRaw`ALTER TABLE "BillableInvocationAdmission" DISABLE TRIGGER "BillableInvocationAdmission_initial_exposure_insert";`;
    try {
      await prisma.$executeRaw`
        INSERT INTO "BillableInvocationAdmission" (
          "id", "invocationId", "admissionRequestId", "requestFingerprint", "logicalOperationId",
          "attemptOrdinal", "fundingPrincipal", "userId", "walletId", "assessmentId",
          "runId", "executionLeaseToken", "agentRole", "operationType", "requestedModel", "resolvedProvider",
          "resolvedModel", "appliedMaxOutputTokens", "maximumExposureMicrocredits", "runtimePolicyVersion",
          "capabilityDigest", "state", "admittedAt", "expiresAt", "correlationId",
          "rolloutMode", "debitMode", "initialExposureMicrocredits", "createdAt", "updatedAt"
        ) VALUES (
          ${histAdmissionId}, ${histInvocationId}, ${histReqId}, ${fingerprint}, ${histLogicalOpId},
          1, 'CUSTOMER_WALLET', ${customerUserId}, ${customerWalletId}, ${assessmentId},
          ${defaultRunId}, ${defaultLeaseToken}, 'assessment-root', 'SYNTHESIS', 'claude-sonnet-4-6', 'anthropic',
          'claude-sonnet-4-6', 4096, 0, 'WP8_TEST',
          'hist-digest', 'SETTLED', NOW(), NOW() + INTERVAL '1 hour', 'hist-corr',
          'ADMISSION_REQUIRED', 'OFF', NULL, NOW(), NOW()
        );
      `;
    } finally {
      await prisma.$executeRaw`ALTER TABLE "BillableInvocationAdmission" ENABLE TRIGGER "BillableInvocationAdmission_initial_exposure_insert";`;
    }

    // Replay the exact request
    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(replayReq);

    assert.equal(res.status, 200);
    const body = successBody<BillableInvocationAdmissionResponse>(res);
    assert.equal(body.admissionId, histAdmissionId);
    assert.equal(body.maximumExposureMicrocredits, "0");
    // Invariant: initialExposureMicrocredits must preserve NULL ("không có snapshot lịch sử") and NOT fabricate "0"
    assert.strictEqual(
      body.initialExposureMicrocredits,
      null,
      "Replay of historical record lacking snapshot MUST return null, not fabricated 0",
    );
  });

  it("RuleSetPreparationBoundary-to-API Integration (G-06 Selected-Rule E2E): RuleSetPreparationBoundary.handle() drives real HTTP admission & consume against live NestJS API on Postgres test DB", async () => {
    const port = listeningPort(app);
    const apiBaseUrl = `http://127.0.0.1:${port}`;

    const source = await prisma.legalSourceVersion.create({
      data: {
        version: `sys-src-bnd-selected-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const prepRunId = `prep-run-bnd-sel-${randomUUID()}`;
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: prepRunId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "RUNNING",
        correlationId: `corr-${prepRunId}`,
        idempotencyKey: `idem-${prepRunId}`,
      },
    });

    const activePolicy = await prisma.platformSponsorshipPolicySnapshot.create({
      data: {
        policyName: "RULE_SET_PREPARATION_SYSTEM",
        policyVersion: `WP8_PREPARATION_SEL_${randomUUID()}`,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        effectiveFrom: new Date(Date.now() - 3600_000),
        effectiveTo: null,
      },
    });

    const resultId = `res-bnd-sel-${randomUUID()}`;

    const pythonScript = `
import asyncio
import json
import sys
from unittest.mock import patch
from rule_set_preparation.boundary import RuleSetPreparationBoundary
from tools.common.capabilities.platform.api_client import WorkerApiClient
from test_selected_rule_preparation import GovernedSelectedFixtureModel

base_url = sys.argv[1]
worker_key = sys.argv[2]
prep_run_id = sys.argv[3]
result_id = sys.argv[4]

client = WorkerApiClient(base_url, worker_key)
client.claim_selected_rule_preparation = lambda run_id: {
    "revision": 1,
    "input": {"ruleId": "r1", "title": "Test Rule", "citations": []},
    "resultId": result_id,
}
client.record_selected_rule_instructions = lambda run_id, r: {"recorded": True}
client.complete_selected_rule_preparation = lambda *args: {"completed": True}

model = GovernedSelectedFixtureModel()
with patch("rule_set_preparation.selected_rule.resolve_agent_model", return_value=model):
    from types import SimpleNamespace
    cfg = SimpleNamespace(nestjs_api_base_url=base_url, worker_api_key=worker_key)
    boundary = RuleSetPreparationBoundary(cfg, api_client=client)
    res = boundary.handle({"preparationRunId": prep_run_id, "preparationRuleResultId": result_id}, "corr-bnd-selected")
    print(json.dumps({"success": True, "res": res, "calls": len(model.calls)}))
`;

    const repoRoot = resolve(apiRoot, "../..");
    const pythonBin = resolve(repoRoot, "deepagents/.venv/bin/python");

    const { stdout } = await execFileAsync(
      pythonBin,
      [
        "-c",
        pythonScript,
        apiBaseUrl,
        WORKER_TEST_API_KEY,
        prepRunId,
        resultId,
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

    const lastJsonLine =
      stdout
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .pop() ?? "{}";
    console.log("FULL SOURCE STDOUT:", stdout);
    const parsed = pythonResult(lastJsonLine);
    assert.equal(parsed.success, true);
    assert.equal(
      parsed.calls,
      1,
      "Model must have been called exactly once through boundary",
    );

    const admission = await prisma.billableInvocationAdmission.findFirst({
      where: { preparationRunId: prepRunId },
    });
    assert.ok(admission, "Admission record must exist in PostgreSQL");
    assert.equal(
      admission.fundingPrincipal,
      ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
    );
    assert.ok(
      admission.state === ADMISSION_STATES.IN_FLIGHT ||
        admission.state === ADMISSION_STATES.OUTCOME_UNKNOWN ||
        admission.state === ADMISSION_STATES.SETTLED,
      `Admission state was ${admission.state}`,
    );
    assert.equal(admission.sponsorshipPolicySnapshotId, activePolicy.id);
    assert.ok(
      admission.initialExposureMicrocredits !== null,
      "initialExposureMicrocredits must be stamped",
    );
    assert.equal(
      admission.initialExposureMicrocredits,
      admission.maximumExposureMicrocredits,
    );
  });

  it("RuleSetPreparationBoundary-to-API Integration (G-06 Full-Source E2E): RuleSetPreparationBoundary.handle() drives real HTTP admission & consume for whole-source run against live NestJS API on Postgres test DB", async () => {
    const port = listeningPort(app);
    const apiBaseUrl = `http://127.0.0.1:${port}`;

    const source = await prisma.legalSourceVersion.create({
      data: {
        version: `sys-src-bnd-full-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const prepRunId = `prep-run-bnd-full-${randomUUID()}`;
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: prepRunId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "RUNNING",
        correlationId: `corr-${prepRunId}`,
        idempotencyKey: `idem-${prepRunId}`,
      },
    });

    const activePolicy = await prisma.platformSponsorshipPolicySnapshot.create({
      data: {
        policyName: "RULE_SET_PREPARATION_SYSTEM",
        policyVersion: `WP8_PREPARATION_FULL_${randomUUID()}`,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        effectiveFrom: new Date(Date.now() - 3600_000),
        effectiveTo: null,
      },
    });

    const pythonScript = `
import asyncio
import json
import sys
import os
from unittest.mock import patch
from rule_set_preparation.boundary import RuleSetPreparationBoundary
from tools.common.capabilities.platform.api_client import WorkerApiClient
from test_rule_set_preparation_runner_admission import GovernedRunnerModel, setup_governed_runner
from test_rule_set_preparation_agent import _bundle
import rule_set_preparation.agent as preparation_agent
from rule_set_preparation.review_frontier import ReviewFrontier

base_url = sys.argv[1]
worker_key = sys.argv[2]
prep_run_id = sys.argv[3]

class DummyPatch:
    def setattr(self, target, name, val):
        if isinstance(target, str):
            mod_name, attr = target.rsplit(".", 1)
            import importlib
            mod = importlib.import_module(mod_name)
            setattr(mod, attr, val)
        else:
            setattr(target, name, val)
    def setenv(self, k, v):
        os.environ[k] = v

setup_governed_runner(DummyPatch())

client = WorkerApiClient(base_url, worker_key)
client.claim_rule_set_preparation = lambda run_id: _bundle()
client.validate_compliance_rule_set = lambda run_id, packet: {"outcome": "PASSED", "failures": []}
client.submit_compliance_rule_set = lambda run_id, key, packet: {"state": "ACTIVATED", "submissionId": "sub-1"}
client.source_review_operation = lambda *args, **kwargs: {
    "outcome": "PASSED",
    "frontierRevision": 1,
    "frontierFingerprint": "a" * 64,
    "frontierStateFingerprint": "b" * 64,
    "progress": {},
    "records": [],
    "nextOffset": None,
}

timeline = []
model = GovernedRunnerModel()
model.timeline = timeline

original_tools = preparation_agent.build_rule_set_tools
def legacy_tools(context):
    graph = context.source_graph
    context.inventory = None
    context.source_graph = None
    try:
        return original_tools(context)
    finally:
        context.source_graph = graph

with patch.object(preparation_agent, "build_rule_set_tools", legacy_tools), \\
     patch.object(ReviewFrontier, "restore", lambda self, **kw: None), \\
     patch("model_policy.resolve_agent_model", return_value=model):
    from types import SimpleNamespace
    cfg = SimpleNamespace(nestjs_api_base_url=base_url, worker_api_key=worker_key)
    boundary = RuleSetPreparationBoundary(cfg, api_client=client)
    res = boundary.handle({"preparationRunId": prep_run_id}, "corr-bnd-full")
    print(json.dumps({"success": True, "res": res, "calls": len(model.calls), "timeline": timeline}))
`;

    const repoRoot = resolve(apiRoot, "../..");
    const pythonBin = resolve(repoRoot, "deepagents/.venv/bin/python");

    const { stdout } = await execFileAsync(
      pythonBin,
      ["-c", pythonScript, apiBaseUrl, WORKER_TEST_API_KEY, prepRunId],
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

    const lastJsonLine =
      stdout
        .trim()
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .pop() ?? "{}";
    console.log("FULL SOURCE STDOUT:", stdout);
    const parsed = pythonResult(lastJsonLine);
    assert.equal(parsed.success, true);
    assert.ok(
      typeof parsed.calls === "number" && parsed.calls >= 1,
      "Model must have been called through whole-source runner",
    );

    const admission = await prisma.billableInvocationAdmission.findFirst({
      where: { preparationRunId: prepRunId },
    });
    assert.ok(
      admission,
      "Admission record must exist in PostgreSQL for full-source run",
    );
    assert.equal(
      admission.fundingPrincipal,
      ADMISSION_FUNDING_PRINCIPALS.PLATFORM_SPONSORED,
    );
    assert.ok(
      admission.state === ADMISSION_STATES.IN_FLIGHT ||
        admission.state === ADMISSION_STATES.OUTCOME_UNKNOWN ||
        admission.state === ADMISSION_STATES.SETTLED,
      `Admission state was ${admission.state}`,
    );
    assert.equal(admission.sponsorshipPolicySnapshotId, activePolicy.id);
    assert.ok(
      admission.initialExposureMicrocredits !== null,
      "initialExposureMicrocredits must be stamped",
    );
    assert.equal(
      admission.initialExposureMicrocredits,
      admission.maximumExposureMicrocredits,
    );
  });
});
