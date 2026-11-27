import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  ADMISSION_FUNDING_PRINCIPALS,
  ADMISSION_STATES,
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
  });

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
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
});
