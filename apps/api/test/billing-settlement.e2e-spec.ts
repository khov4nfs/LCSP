/**
 * WP8 Phase C Acceptance Tests: Shadow Settlement, Token Accounting & Reconciliation Boundaries
 *
 * Rationale ("Why"): Validates Phase C shadow settlement (MODEL_USAGE_DEBIT = SHADOW)
 * where token usage is accurately measured and priced, ModelUsageReceipt is persisted with
 * strict field isolation, and wallet balances are strictly preserved (0 debited microcredits).
 *
 * Invariants & Constraints:
 * 1. Schema & Field Isolation: ModelUsageReceipt separates calculatedMicrocredits, debitedMicrocredits,
 *    shadowMicrocredits, and chargedMicrocredits so trial calculations can never be confused with actual debits.
 * 2. Confirmed Usage Settlement: Valid provider tokens transition IN_FLIGHT -> SETTLED, release concurrency slot,
 *    and leave wallet spendableMicrocredits 100% untouched.
 * 3. ADR-028 Line 155 & Line 94 Invariant: An invocation in IN_FLIGHT cannot be closed as CONFIRMED_NO_USAGE
 *    based on worker self-attestation or worker-signed HMAC. It must transition to DISPATCH_UNKNOWN and keep
 *    the concurrency slot blocked until independent provider reconciliation or server-trusted egress verification.
 * 4. Atomic Pre-Consume Cancellation: An unconsumed ADMITTED invocation can safely transition to CONFIRMED_NO_USAGE
 *    (or REVOKED) before consume. If consume wins the race, cancellation fails and the slot remains held.
 * 5. Provider Reconciliation (Test 3C): Provider log verification must link to the exact invocation, prove provider
 *    correlation ID tracking capability, and cover the entire time window before resolving to CONFIRMED_NO_USAGE.
 */

import * as assert from "node:assert/strict";
import * as crypto from "node:crypto";
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
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  PROVIDER_COMPLETION_STATES,
  RECONCILIATION_CASE_STATES,
  TOKEN_BUCKET_POLICIES,
  computeWorkerPreSocketRejectionHmac,
  deriveAdmissionCapabilityDigest,
  deriveAdmissionCapabilitySecret,
  type BillableInvocationAdmissionRequest,
  type BillableInvocationAdmissionResponse,
  type BillableInvocationAdmissionConsume,
  type BillableInvocationSettlementRequest,
  type BillableInvocationSettlementResponse,
  type BillableInvocationCancelRequest,
  type ReconciliationNoUsageResolutionRequest,
} from "@lcsp/contracts/billing";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import { ReconciliationArtifactService } from "../src/modules/billing/application/shared/reconciliation-artifact.service.js";
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
const defaultLeaseToken = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const defaultRunId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const defaultMasterKey = "server-dedicated-admission-master-key-secret-32b";

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

describe("WP8 Phase C: Shadow Settlement, Token Accounting & Reconciliation Boundaries (Postgres e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let artifactService: ReconciliationArtifactService;
  let adminToken: string;
  let customerToken: string;
  let customerUserId: string;
  let customerWalletId: string;
  let assessmentId: string;
  let publishedSnapshotId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_TEST_API_KEY;
    process.env.BILLING_ADMISSION_MASTER_KEY = defaultMasterKey;
    process.env.MODEL_USAGE_DEBIT = "SHADOW";

    await ensureMigratedSchema();
    ensureIdempotentMigrateDeploy();

    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    artifactService = app.get(ReconciliationArtifactService);
  });

  afterAll(async () => {
    delete process.env.MODEL_USAGE_DEBIT;
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "ModelOutputEvaluation",
        "ModelUsageReceipt",
        "ProviderLogArtifact",
        "BillingReconciliationCase",
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

    const adminSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "nomembership@acme.test",
      password: "NoMembership123!",
    });
    adminToken = successBody<SignInSuccess>(adminSignIn).session_token ?? "";

    const customerSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    customerToken =
      successBody<SignInSuccess>(customerSignIn).session_token ?? "";

    // Customer wallet initialized with 100,000,000 microcredits (100 credits)
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
        id: `asm-settle-${Date.now()}`,
        name: "Settlement E2E Assessment",
        ownerId: customerUserId,
      },
    });
    assessmentId = assessment.id;

    // Active AssessmentRuntime
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

    // Pinned Tariff Snapshot: 3 microcredits/input token (3,000,000/M), 15 microcredits/output token (15,000,000/M)
    // Reasoning: 15 microcredits/token (15,000,000/M, separateRate)
    // Cached Input: 0.6 microcredits/token (600,000/M, separateRate)
    // Cache Write: 0.6 microcredits/token (600,000/M, separateRate)
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
        reasoningPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        reasoningMicrocreditsPerMillion: 15_000_000n,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cachedInputMicrocreditsPerMillion: 600_000n,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cacheWriteMicrocreditsPerMillion: 600_000n,
        idempotencyKey: `publish-settlement-${Date.now()}`,
        requestFingerprint: "e".repeat(64),
        publishedBy: "system-test",
        auditReason: "E2E Settlement seed tariff",
      },
    });
    publishedSnapshotId = snapshot.id;

    await prisma.customerModelTariffAssignment.create({
      data: {
        tariffSnapshotId: snapshot.id,
        scope: MODEL_PRICING_SCOPES.exactModel,
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        effectiveFrom: new Date(Date.now() - 3600_000),
        effectiveTo: null,
        createdBy: "system-test",
      },
    });
  });

  // Helper to obtain ADMITTED invocation
  async function requestAdmissionHelper(
    requestId: string,
    overrides?: Partial<BillableInvocationAdmissionRequest>,
  ): Promise<BillableInvocationAdmissionResponse> {
    const payload: BillableInvocationAdmissionRequest = {
      admissionRequestId: requestId,
      logicalOperationId: `op-${requestId}`,
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
      ...overrides,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(payload);

    assert.equal(
      res.status,
      201,
      `Failed to request admission: ${JSON.stringify(res.body)}`,
    );
    return successBody<BillableInvocationAdmissionResponse>(res);
  }

  // Helper to consume ADMITTED invocation to IN_FLIGHT
  async function consumeAdmissionHelper(
    admission: BillableInvocationAdmissionResponse,
  ): Promise<void> {
    const consumePayload: BillableInvocationAdmissionConsume = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/consume")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(consumePayload);

    assert.equal(
      res.status,
      200,
      `Failed to consume admission: ${JSON.stringify(res.body)}`,
    );
  }

  // -------------------------------------------------------------------------
  // RED Test 1: Schema & Field Isolation on ModelUsageReceipt
  // -------------------------------------------------------------------------
  it("RED Test 1: enforces ModelUsageReceipt financial field isolation (calculated, debited=0, shadow, charged=0)", async () => {
    const admission = await requestAdmissionHelper(
      "req-settle-field-isolation",
    );
    await consumeAdmissionHelper(admission);

    // 10,000 input tokens * 3 = 30,000 microcredits
    // 1,000 output tokens * 15 = 15,000 microcredits
    // Total calculated = 45,000 microcredits
    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      durationMs: 1250,
      providerResponseId: "resp-prov-isolation-1",
    };

    const res = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(
      res.status,
      200,
      `Expected 200 from settlement, got ${res.status}`,
    );
    const body = successBody<BillableInvocationSettlementResponse>(res);

    assert.equal(body.settled, true);
    assert.equal(body.debitMode, MODEL_USAGE_DEBIT_MODES.SHADOW);
    assert.equal(body.calculatedMicrocredits, "45000");
    assert.equal(body.debitedMicrocredits, "0");
    assert.equal(body.shadowMicrocredits, "45000");
    assert.equal(body.chargedMicrocredits, "0");

    // Inspect database persistence of ModelUsageReceipt directly
    const receipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(receipt, "ModelUsageReceipt record must exist in DB");
    assert.equal((receipt as any).calculatedMicrocredits, 45_000n);
    assert.equal((receipt as any).debitedMicrocredits, 0n);
    assert.equal((receipt as any).shadowMicrocredits, 45_000n);
    assert.equal(receipt.chargedMicrocredits, 0n);

    // Verify zero financial transaction in CreditLedgerEntry
    const ledgerDebits = await prisma.creditLedgerEntry.count({
      where: {
        walletId: customerWalletId,
        admissionId: admission.admissionId,
      },
    });
    assert.equal(
      ledgerDebits,
      0,
      "No financial debit ledger entries must be created in SHADOW mode",
    );

    // Verify customer wallet balance is 100% untouched
    const wallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.equal(wallet?.balanceMicrocredits, 100_000_000n);
  });

  // -------------------------------------------------------------------------
  // RED Test 2: Confirmed Usage Settlement in SHADOW Mode Releases Slot & Emits Audit
  // -------------------------------------------------------------------------
  it("RED Test 2: settles CONFIRMED_USAGE to SETTLED, releases concurrency slot, and emits audit event", async () => {
    const admission = await requestAdmissionHelper("req-settle-release-slot");
    await consumeAdmissionHelper(admission);

    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 5_000,
      outputTokens: 500,
      totalTokens: 5_500,
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200);
    const settleData =
      successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(settleData.state, ADMISSION_STATES.SETTLED);
    assert.equal(settleData.slotReleased, true);

    // Assert audit event persisted in database
    const audit = await prisma.auditEvent.findFirst({
      where: {
        resourceId: admission.admissionId,
        eventType: BILLING_AUDIT_EVENT_TYPES.usageSettled,
      },
    });
    assert.ok(
      audit,
      "AuditEvent for usage settlement must be persisted in database",
    );
    assert.equal(audit.eventType, BILLING_AUDIT_EVENT_TYPES.usageSettled);
    assert.equal((audit.payload as any).calculatedMicrocredits, "22500");

    // Concurrency slot must now be FREE: next request on same wallet must succeed
    const nextAdmission = await requestAdmissionHelper(
      "req-settle-next-slot-available",
    );
    assert.equal(nextAdmission.state, ADMISSION_STATES.ADMITTED);
  });

  // -------------------------------------------------------------------------
  // RED Test 2B: Missing Token Usage Evidence Rejection
  // -------------------------------------------------------------------------
  it("RED Test 2B: COMPLETED with missing token evidence transitions to OUTCOME_UNKNOWN, retains exposure, and keeps slot blocked", async () => {
    const admission = await requestAdmissionHelper("req-settle-missing-tokens");
    await consumeAdmissionHelper(admission);

    // Worker claims COMPLETED but does not provide token usage evidence
    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      // inputTokens and outputTokens omitted
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200);
    const body = successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(body.settled, false);
    assert.equal(body.state, ADMISSION_STATES.OUTCOME_UNKNOWN);
    assert.equal(body.slotReleased, false);

    // Verify reconciliation case opened in OPEN state
    const reconCase = await prisma.billingReconciliationCase.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(reconCase, "BillingReconciliationCase must be created");
    assert.equal(reconCase.state, RECONCILIATION_CASE_STATES.OPEN);

    // Concurrency slot must remain BLOCKED: next request on same wallet fails with 429/409
    const blockedRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-blocked-by-missing-token-outcome-unknown",
        logicalOperationId: "op-blocked-missing-tokens",
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
      });

    assert.ok(
      blockedRes.status === 429 || blockedRes.status === 409,
      `Expected 429 or 409 due to retained exposure holding concurrency slot, got ${blockedRes.status}`,
    );
  });

  // -------------------------------------------------------------------------
  // RED Test 2C: Canonical Calculator for Cache, Reasoning, and Rounding
  // -------------------------------------------------------------------------
  it("RED Test 2C: delegates pricing to canonical calculator for cached input, reasoning tokens, and integer rounding", async () => {
    // 1. Multi-bucket calculation: 10k input, 4k cached input, 2k output, 500 reasoning
    // Input: 3/token (3,000,000/M), Output: 15/token (15,000,000/M)
    // Cached: 0.6/token (600,000/M), Reasoning: 15/token (15,000,000/M)
    // Numerator = 10,000 * 3M + 2,000 * 15M + 4,000 * 0.6M + 500 * 15M
    //           = 30,000M + 30,000M + 2,400M + 7,500M = 69,900,000,000
    // Total = 69,900 microcredits
    const admission = await requestAdmissionHelper(
      "req-settle-reasoning-pricing",
    );
    await consumeAdmissionHelper(admission);

    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 10_000,
      cachedInputTokens: 4_000,
      outputTokens: 2_000,
      reasoningTokens: 500,
      totalTokens: 12_000,
      providerResponseId: "resp-reasoning-1",
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200);
    const body = successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(body.settled, true);
    assert.equal(body.calculatedMicrocredits, "69900");

    // 2. Sub-microcredit rounding test across multiple fractional buckets:
    // Rate for cachedInput: 600,000/M (0.6 microcredit/token)
    // Rate for cacheWrite: 600,000/M (0.6 microcredit/token)
    // With 1 token of cachedInput and 1 token of cacheWrite (inputTokens: 0, outputTokens: 0):
    // Separate integer division:
    //   floor(1 * 600,000 / 1,000,000) + floor(1 * 600,000 / 1,000,000) = 0 + 0 = 0 microcredits
    // Single integer division (sum all bucket numerators first):
    //   floor((600,000 + 600,000) / 1,000,000) = floor(1,200,000 / 1,000,000) = 1 microcredit!
    // This strictly discriminates against separate bucket division.
    const roundingAdmission = await requestAdmissionHelper(
      "req-settle-rounding-pricing",
    );
    await consumeAdmissionHelper(roundingAdmission);

    const roundingSettleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: roundingAdmission.admissionId,
        invocationId: roundingAdmission.invocationId,
        capabilityToken: roundingAdmission.capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
        inputTokens: 0,
        cachedInputTokens: 1,
        cacheWriteTokens: 1,
        outputTokens: 0,
        totalTokens: 2,
      });

    assert.equal(roundingSettleRes.status, 200);
    const roundingBody =
      successBody<BillableInvocationSettlementResponse>(roundingSettleRes);
    assert.equal(roundingBody.settled, true);
    assert.equal(roundingBody.calculatedMicrocredits, "1");
  });

  // -------------------------------------------------------------------------
  // RED Test 2E: Missing Pinned Tariff Snapshot Routes to INTEGRITY_REVIEW
  // -------------------------------------------------------------------------
  it("RED Test 2E: missing pinned tariff snapshot transitions to OUTCOME_UNKNOWN, routes to INTEGRITY_REVIEW, and holds slot", async () => {
    const admission = await requestAdmissionHelper(
      "req-settle-missing-tariff-snapshot",
    );
    await consumeAdmissionHelper(admission);

    // Corrupt or remove pinned snapshot reference in DB to simulate unresolvable tariff authority
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.admissionId },
      data: { tariffSnapshotId: null },
    });

    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200);
    const body = successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(body.settled, false);
    assert.equal(body.state, ADMISSION_STATES.OUTCOME_UNKNOWN);
    assert.equal(body.slotReleased, false);

    // Verify reconciliation case opened in INTEGRITY_REVIEW
    const reconCase = await prisma.billingReconciliationCase.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(reconCase, "BillingReconciliationCase must be created");
    assert.equal(reconCase.state, RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW);
    assert.equal(
      (reconCase.conflictingPayload as any).reason,
      "MISSING_PINNED_TARIFF_SNAPSHOT",
    );

    // Concurrency slot must remain BLOCKED: next request fails with 429/409
    const blockedRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-blocked-by-missing-tariff-integrity-review",
        logicalOperationId: "op-blocked-missing-tariff",
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
      });

    assert.ok(
      blockedRes.status === 429 || blockedRes.status === 409,
      `Expected 429 or 409 due to retained exposure holding concurrency slot, got ${blockedRes.status}`,
    );

    // Verify zero ModelUsageReceipt persisted in SETTLED state
    const receipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(
      receipt,
      null,
      "Must not persist ModelUsageReceipt when tariff snapshot is missing",
    );
  });

  // -------------------------------------------------------------------------
  // RED Test 2F: Usage Exceeding Admitted Maximum Exposure Routes to INTEGRITY_REVIEW
  // -------------------------------------------------------------------------
  it("RED Test 2F: usage exceeding admitted maximum exposure routes to INTEGRITY_REVIEW, retains exposure, and keeps slot blocked (ADR-028 Line 138)", async () => {
    // Request admission with small token bounds: 100 input, 100 output
    // Maximum exposure = 100 * 3 + 100 * 15 = 1,800 microcredits
    const admission = await requestAdmissionHelper(
      "req-settle-excessive-usage",
      {
        inputTokensUpperBound: 100,
        outputTokensUpperBound: 100,
      },
    );
    await consumeAdmissionHelper(admission);

    const initialAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(initialAdm?.maximumExposureMicrocredits, 1800n);

    // Settle with usage far exceeding admitted exposure: 5k input, 1k output = 15k + 15k = 30,000 microcredits > 1,800
    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 5_000,
      outputTokens: 1_000,
      totalTokens: 6_000,
      providerResponseId: "resp-excessive-1",
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200);
    const body = successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(body.settled, false);
    assert.equal(body.state, ADMISSION_STATES.OUTCOME_UNKNOWN);
    assert.equal(body.slotReleased, false);

    // Verify reconciliation case routed to INTEGRITY_REVIEW with recorded anomaly
    const reconCase = await prisma.billingReconciliationCase.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(reconCase, "BillingReconciliationCase must be created");
    assert.equal(reconCase.state, RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW);
    assert.equal(
      (reconCase.conflictingPayload as any).reason,
      "EXCESSIVE_USAGE_BEYOND_ADMITTED_EXPOSURE",
    );
    assert.equal(
      (reconCase.conflictingPayload as any).calculatedMicrocredits,
      "30000",
    );
    assert.equal(
      (reconCase.conflictingPayload as any).maximumExposureMicrocredits,
      "1800",
    );

    // Concurrency slot must remain BLOCKED: next request fails with 429/409
    const blockedRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-blocked-by-excessive-usage-integrity-review",
        logicalOperationId: "op-blocked-excessive-usage",
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
      });

    assert.ok(
      blockedRes.status === 429 || blockedRes.status === 409,
      `Expected 429 or 409 due to retained exposure holding concurrency slot, got ${blockedRes.status}`,
    );

    // Verify admission exposure was NOT expanded beyond admitted ceiling
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(dbAdm?.maximumExposureMicrocredits, 1800n);

    // Verify zero ModelUsageReceipt persisted in SETTLED state
    const receipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(
      receipt,
      null,
      "Must not persist ModelUsageReceipt when usage exceeds admitted exposure",
    );
  });

  // -------------------------------------------------------------------------
  // RED Test 2D: Settlement Replay Idempotency vs Conflicting Payload (ADR-028 Line 138)
  // -------------------------------------------------------------------------
  it("RED Test 2D: handles settlement replay idempotently for identical payload, rejects conflicting payload with 409", async () => {
    const admission = await requestAdmissionHelper("req-settle-idempotency");
    await consumeAdmissionHelper(admission);

    const originalPayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 8_000,
      outputTokens: 1_200,
      totalTokens: 9_200,
      durationMs: 950,
      providerResponseId: "resp-idempotent-original",
    };

    // First settlement
    const firstRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(originalPayload);

    assert.equal(firstRes.status, 200);
    const firstBody =
      successBody<BillableInvocationSettlementResponse>(firstRes);
    assert.equal(firstBody.settled, true);
    assert.equal(firstBody.calculatedMicrocredits, "42000"); // 8000*3 + 1200*15 = 24000 + 18000 = 42000

    // Lost-response retry with exact same settlement payload (ADR-028 Line 138)
    const retryRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(originalPayload);

    assert.equal(
      retryRes.status,
      200,
      "Lost-response retry must return HTTP 200 idempotently",
    );
    const retryBody =
      successBody<BillableInvocationSettlementResponse>(retryRes);
    assert.equal(retryBody.settled, true);
    assert.equal(retryBody.calculatedMicrocredits, "42000");
    assert.equal(retryBody.slotReleased, true);

    // Verify only 1 ModelUsageReceipt row exists in DB
    const receiptCount = await prisma.modelUsageReceipt.count({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(
      receiptCount,
      1,
      "Idempotent retry must not duplicate ModelUsageReceipt",
    );

    // Conflicting replay with different token count on already settled invocation
    const conflictingPayload: BillableInvocationSettlementRequest = {
      ...originalPayload,
      inputTokens: 99_999,
    };

    const conflictRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(conflictingPayload);

    assert.equal(
      conflictRes.status,
      409,
      "Conflicting payload on settled invocation must be rejected with 409",
    );
    const problem = problemBody(conflictRes);
    assert.equal(problem.code, BILLING_ERROR_CODES.admissionAlreadySettled);
  });

  // -------------------------------------------------------------------------
  // RED Test 3A: Worker reports abort without durable proof -> DISPATCH_UNKNOWN
  // -------------------------------------------------------------------------
  it("RED Test 3A: transitions unverified abort to DISPATCH_UNKNOWN, retains exposure, and keeps slot blocked", async () => {
    const admission = await requestAdmissionHelper(
      "req-settle-unverified-abort",
    );
    await consumeAdmissionHelper(admission);

    // Worker reports failure / abort without independent proof
    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.FAILED,
      finishReason: "aborted_by_client_network_disconnect",
    };

    const res = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    // Server must reject closing usage: returns 202 or 200 with state DISPATCH_UNKNOWN and slotBlocked
    assert.ok(res.status === 200 || res.status === 202);
    const body = successBody<BillableInvocationSettlementResponse>(res);
    assert.equal(body.settled, false);
    assert.equal(body.state, ADMISSION_STATES.DISPATCH_UNKNOWN);
    assert.equal(body.slotReleased, false);

    // Concurrency slot must remain BLOCKED: next request fails with 429/409
    const blockedPayload: BillableInvocationAdmissionRequest = {
      admissionRequestId: "req-should-be-blocked-by-dispatch-unknown",
      logicalOperationId: "op-blocked",
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

    const blockedRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(blockedPayload);

    assert.ok(blockedRes.status === 429 || blockedRes.status === 409);
    assert.equal(
      problemBody(blockedRes).code,
      BILLING_ERROR_CODES.walletConcurrencyLimitExceeded,
    );
  });

  // -------------------------------------------------------------------------
  // RED Test 3B: Worker-Signed HMAC is INSUFFICIENT for IN_FLIGHT -> DISPATCH_UNKNOWN
  // -------------------------------------------------------------------------
  it("RED Test 3B: refuses to close IN_FLIGHT on worker-signed HMAC claim, forces DISPATCH_UNKNOWN, and blocks slot", async () => {
    const admission = await requestAdmissionHelper(
      "req-settle-worker-hmac-insufficient",
    );
    await consumeAdmissionHelper(admission);

    // Worker attempts to claim LOCAL_PRE_SOCKET_REJECTION with mathematically valid HMAC
    const failureCategory = "LOCAL_PRE_SOCKET_REJECTION";
    const clientTimestamp = new Date().toISOString();
    const validHmac = computeWorkerPreSocketRejectionHmac(
      admission.capabilityToken,
      admission.admissionId,
      admission.invocationId,
      failureCategory,
      clientTimestamp,
    );

    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.FAILED,
      workerClaimedPreSocketError: true,
      workerClaimFailureCategory: failureCategory,
      workerClaimTimestamp: clientTimestamp,
      workerClaimSignature: validHmac,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    // Invariant (ADR-028 Line 94): Server MUST NOT trust worker HMAC to transition to CONFIRMED_NO_USAGE
    assert.ok(res.status === 200 || res.status === 202);
    const body = successBody<BillableInvocationSettlementResponse>(res);
    assert.notEqual(body.state, ADMISSION_STATES.CONFIRMED_NO_USAGE);
    assert.equal(body.state, ADMISSION_STATES.DISPATCH_UNKNOWN);
    assert.equal(body.slotReleased, false);

    // Verify slot remains strictly held
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(dbAdm?.state, ADMISSION_STATES.DISPATCH_UNKNOWN);
    assert.ok(dbAdm && dbAdm.maximumExposureMicrocredits > 0n);

    // Verify wallet concurrency slot is STILL BLOCKED
    const blockedRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-blocked-by-hmac-disallow",
        logicalOperationId: "op-blocked-hmac",
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
      });

    assert.ok(blockedRes.status === 429 || blockedRes.status === 409);
    assert.equal(
      problemBody(blockedRes).code,
      BILLING_ERROR_CODES.walletConcurrencyLimitExceeded,
    );
  });

  // -------------------------------------------------------------------------
  // RED Test 3C: Audited Provider Reconciliation for DISPATCH_UNKNOWN
  // -------------------------------------------------------------------------
  it("RED Test 3C: resolves DISPATCH_UNKNOWN to CONFIRMED_NO_USAGE ONLY with Admin RBAC and comprehensive provider log coverage", async () => {
    const admission = await requestAdmissionHelper("req-settle-recon-audit");
    await consumeAdmissionHelper(admission);

    // Move to DISPATCH_UNKNOWN first
    await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.OUTCOME_UNKNOWN,
      });

    // Subcase 3C.0: Automated provider reconciliation is CLOSED by default in operational posture
    const defaultClosedRes = await httpRequest(app)
      .post("/admin/billing/reconciliation/resolve-no-usage")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        caseId: `case-${admission.invocationId}`,
        invocationId: admission.invocationId,
        provider: "anthropic",
        providerCorrelationId: `corr-${admission.invocationId}`,
        providerLogArtifactId: "art-initial-check",
        providerLogArchiveSha256: "0".repeat(64),
        providerLogCoverageStart: new Date().toISOString(),
        providerLogCoverageEnd: new Date().toISOString(),
        auditRationale: "Checking default closed posture",
      });
    assert.equal(
      defaultClosedRes.status,
      422,
      "Automated provider reconciliation must be closed by default in operational posture",
    );
    assert.equal(
      problemBody(defaultClosedRes).code,
      BILLING_ERROR_CODES.providerCorrelationUnsupported,
    );

    // Explicitly enable automated reconciliation gate for test execution
    process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE = "ON";

    try {
      // Backdate admission to simulate an invocation whose potential dispatch window has elapsed into the past
      const nowMs = Date.now();
      const pastAdmittedAt = new Date(nowMs - 3600_000); // 1 hour ago
      const pastConsumedAt = new Date(nowMs - 3500_000);
      const pastExpiresAt = new Date(nowMs - 3000_000);
      await prisma.billableInvocationAdmission.update({
        where: { id: admission.admissionId },
        data: {
          admittedAt: pastAdmittedAt,
          consumedAt: pastConsumedAt,
          expiresAt: pastExpiresAt,
        },
      });

      const dbAdmBefore = await prisma.billableInvocationAdmission.findUnique({
        where: { invocationId: admission.invocationId },
      });

      const coverageStart = new Date(nowMs - 4000_000);
      const coverageEnd = new Date(nowMs - 1000);
      const finalizedWatermark = new Date(nowMs - 1000); // Sealed 1s ago (<= now and >= potentialDispatchEnd)

      // Register authentic provider Ed25519 keypair for Anthropic with AUDITED authority
      const anthropicKeypair =
        artifactService.generateAndRegisterProviderKeyPair(
          "anthropic",
          "key-anthropic-prod-v1",
          true, // isAudited = true
        );

      const makeSignedArtifactParams = (params: {
        artifactId: string;
        provider?: string;
        coverageStart: Date;
        coverageEnd: Date;
        finalizedWatermark?: Date;
        entries?: any[];
        tamperSignature?: string;
        keyPem?: string;
        keyId?: string;
      }) => {
        const provider = params.provider ?? "anthropic";
        const entries = params.entries ?? [];
        const rawContent = JSON.stringify(entries);
        const sha256 = crypto
          .createHash("sha256")
          .update(rawContent)
          .digest("hex");
        const watermark = params.finalizedWatermark ?? params.coverageEnd;
        const statement = artifactService.computeCanonicalStatement({
          provider,
          artifactId: params.artifactId,
          sha256,
          coverageStart: params.coverageStart,
          coverageEnd: params.coverageEnd,
          finalizedWatermark: watermark,
        });
        const signingPem = params.keyPem ?? anthropicKeypair.privateKeyPem;
        const signingId = params.keyId ?? anthropicKeypair.keyId;
        const signature =
          params.tamperSignature ??
          artifactService.signArtifactStatement(statement, signingPem);
        return {
          artifactId: params.artifactId,
          provider,
          signingKeyId: signingId,
          providerSignature: signature,
          coverageStart: params.coverageStart,
          coverageEnd: params.coverageEnd,
          finalizedWatermark: watermark,
          entries,
        };
      };

      // Register a valid trusted provider audit log artifact with ZERO entries matching admission.correlationId
      // Durably persisted in PostgreSQL with authentic Ed25519 cryptographic signature and finalized watermark
      const validArtifactParams = makeSignedArtifactParams({
        artifactId: `art-anthropic-audit-${admission.invocationId}`,
        provider: "anthropic",
        coverageStart,
        coverageEnd,
        finalizedWatermark,
        entries: [
          {
            requestId: "req-prov-1",
            timestamp: new Date(nowMs - 3800_000).toISOString(),
            correlationId: "other-correlation-id-aaa",
          },
          {
            requestId: "req-prov-2",
            timestamp: new Date(nowMs - 3400_000).toISOString(),
            correlationId: "other-correlation-id-bbb",
          },
        ],
      });
      const validArtifact =
        await artifactService.ingestVerifiedProviderLog(validArtifactParams);
      assert.equal(
        validArtifact.verified,
        true,
        "Validly signed provider artifact must be verified",
      );

      const baseReconPayload = {
        caseId: `case-${admission.invocationId}`,
        invocationId: admission.invocationId,
        provider: "anthropic",
        providerCorrelationId: `corr-${admission.invocationId}`,
        providerLogArtifactId: validArtifact.artifactId,
        providerLogArchiveSha256: validArtifact.sha256,
        providerLogCoverageStart: coverageStart.toISOString(),
        providerLogCoverageEnd: coverageEnd.toISOString(),
        auditRationale:
          "Audited Anthropic access logs archive: zero requests matched correlationId in temporal window",
      };

      // Subcase 3C.1: Admin RBAC enforcement (401 unauthenticated, 403 non-admin, 403 worker key)
      const unauthRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .send(baseReconPayload);
      assert.equal(
        unauthRes.status,
        401,
        "Reconciliation endpoint must reject unauthenticated requests with 401",
      );

      const workerAuthRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send(baseReconPayload);
      assert.ok(
        workerAuthRes.status === 401 || workerAuthRes.status === 403,
        "Reconciliation endpoint must reject worker api key without admin session",
      );

      const customerAuthRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${customerToken}`)
        .send(baseReconPayload);
      assert.equal(
        customerAuthRes.status,
        403,
        "Reconciliation endpoint must reject non-admin users with 403",
      );

      // Subcase 3C.2: Authority check - provider does NOT support client-side correlation IDs
      const unsupportedProviderRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          provider: "mock-unsupported-provider",
        });
      assert.equal(
        unsupportedProviderRes.status,
        422,
        "Must reject resolution for providers without correlation logging",
      );
      assert.equal(
        problemBody(unsupportedProviderRes).code,
        BILLING_ERROR_CODES.providerCorrelationUnsupported,
      );

      // Subcase 3C.3a: Fake artifact ID (not found in trusted store)
      const fakeArtifactRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArtifactId: "art-completely-fake-nonexistent",
        });
      assert.equal(
        fakeArtifactRes.status,
        422,
        "Must reject fake/unregistered artifact IDs",
      );
      assert.equal(
        problemBody(fakeArtifactRes).code,
        BILLING_ERROR_CODES.invalidReconciliationEvidence,
      );

      // Subcase 3C.3a1: Test key without audited authority produces verified=false and fails
      const unauditedKeypair =
        artifactService.generateAndRegisterProviderKeyPair(
          "anthropic",
          "key-unaudited-fixture",
          false, // isAudited = false
        );
      const unauditedArtifact = await artifactService.ingestVerifiedProviderLog(
        makeSignedArtifactParams({
          artifactId: `art-anthropic-unaudited-${admission.invocationId}`,
          coverageStart,
          coverageEnd,
          finalizedWatermark,
          keyPem: unauditedKeypair.privateKeyPem,
          keyId: unauditedKeypair.keyId,
        }),
      );
      assert.equal(
        unauditedArtifact.verified,
        false,
        "Unaudited keypair must produce verified=false",
      );
      const unauditedRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArtifactId: unauditedArtifact.artifactId,
          providerLogArchiveSha256: unauditedArtifact.sha256,
        });
      assert.equal(
        unauditedRes.status,
        422,
        "Must reject resolution for artifact signed with unaudited key",
      );
      assert.equal(
        problemBody(unauditedRes).code,
        BILLING_ERROR_CODES.invalidReconciliationEvidence,
      );

      // Subcase 3C.3a2: Non-empty but cryptographically invalid signature (fails closed)
      const invalidSigArtifact =
        await artifactService.ingestVerifiedProviderLog(
          makeSignedArtifactParams({
            artifactId: `art-anthropic-invalid-sig-${admission.invocationId}`,
            coverageStart,
            coverageEnd,
            finalizedWatermark,
            tamperSignature: Buffer.from(
              "non-empty-bogus-signature-bytes-not-valid-ed25519",
            ).toString("base64"),
          }),
        );
      assert.equal(
        invalidSigArtifact.verified,
        false,
        "Non-empty but cryptographically invalid signature must fail to verified=false",
      );
      const invalidSigRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArtifactId: invalidSigArtifact.artifactId,
          providerLogArchiveSha256: invalidSigArtifact.sha256,
        });
      assert.equal(
        invalidSigRes.status,
        422,
        "Must reject unverified artifacts with cryptographically invalid signatures",
      );
      assert.equal(
        problemBody(invalidSigRes).code,
        BILLING_ERROR_CODES.invalidReconciliationEvidence,
      );

      // Subcase 3C.3a3: Ingest caller attempting to self-assert verified: true (server ignores and verifies crypto)
      const selfAssertedParams = {
        ...makeSignedArtifactParams({
          artifactId: `art-anthropic-self-asserted-${admission.invocationId}`,
          coverageStart,
          coverageEnd,
          finalizedWatermark,
          tamperSignature: Buffer.from(
            "forged-signature-with-self-asserted-flag",
          ).toString("base64"),
        }),
        verified: true, // Caller attempts to forge verified flag!
      };
      const selfAssertedArtifact =
        await artifactService.ingestVerifiedProviderLog(selfAssertedParams);
      assert.equal(
        selfAssertedArtifact.verified,
        false,
        "Server MUST ignore caller self-asserted verified=true",
      );
      const selfAssertedRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArtifactId: selfAssertedArtifact.artifactId,
          providerLogArchiveSha256: selfAssertedArtifact.sha256,
        });
      assert.equal(
        selfAssertedRes.status,
        422,
        "Must reject self-asserted unverified artifact",
      );
      assert.equal(
        problemBody(selfAssertedRes).code,
        BILLING_ERROR_CODES.invalidReconciliationEvidence,
      );

      // Subcase 3C.3a4: Attempt to overwrite an existing verified artifact (Immutability enforcement)
      await assert.rejects(
        async () => {
          await artifactService.ingestVerifiedProviderLog(validArtifactParams);
        },
        /already exists and is immutable/,
        "Service must strictly reject attempts to overwrite existing artifactId",
      );

      // Subcase 3C.3b: Fake hash on registered artifact
      const fakeHashRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArchiveSha256: "0".repeat(64),
        });
      assert.equal(
        fakeHashRes.status,
        422,
        "Must reject mismatched SHA-256 artifact hashes",
      );
      assert.equal(
        problemBody(fakeHashRes).code,
        BILLING_ERROR_CODES.invalidReconciliationEvidence,
      );

      // Subcase 3C.3c: Artifact containing a dispatched request matching admission.correlationId
      const dispatchedArtifact =
        await artifactService.ingestVerifiedProviderLog(
          makeSignedArtifactParams({
            artifactId: `art-anthropic-dispatched-${admission.invocationId}`,
            provider: "anthropic",
            coverageStart,
            coverageEnd,
            finalizedWatermark,
            entries: [
              {
                requestId: "req-prov-dispatched-1",
                timestamp: new Date(nowMs - 3500_000).toISOString(),
                correlationId: dbAdmBefore?.correlationId, // Request actually reached provider!
              },
            ],
          }),
        );
      assert.equal(dispatchedArtifact.verified, true);
      const dispatchedRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArtifactId: dispatchedArtifact.artifactId,
          providerLogArchiveSha256: dispatchedArtifact.sha256,
        });
      assert.equal(
        dispatchedRes.status,
        422,
        "Must reject no-usage claim if provider logs prove request was dispatched",
      );
      assert.equal(
        problemBody(dispatchedRes).code,
        BILLING_ERROR_CODES.invalidReconciliationEvidence,
      );

      // Subcase 3C.4a: Coverage window incomplete (coverageEnd is before potentialDispatchEnd)
      const truncatedWindowRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogCoverageStart: new Date(nowMs - 4000_000).toISOString(),
          providerLogCoverageEnd: new Date(nowMs - 3400_000).toISOString(), // Ended before potentialDispatchEnd (-3200_000)!
        });
      assert.equal(
        truncatedWindowRes.status,
        422,
        "Must reject resolution when provider log coverage window is incomplete",
      );
      assert.equal(
        problemBody(truncatedWindowRes).code,
        BILLING_ERROR_CODES.incompleteReconciliationWindow,
      );

      // Subcase 3C.4b: Log finalized watermark ends before potential dispatch timeout (watermark only at -3400s, dispatch requires -3200s)
      const incompleteWatermarkArtifact =
        await artifactService.ingestVerifiedProviderLog(
          makeSignedArtifactParams({
            artifactId: `art-anthropic-incomplete-watermark-${admission.invocationId}`,
            coverageStart,
            coverageEnd,
            finalizedWatermark: new Date(nowMs - 3400_000), // Watermark seals only up to -3400s!
          }),
        );
      assert.equal(incompleteWatermarkArtifact.verified, true);
      const incompleteWatermarkRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArtifactId: incompleteWatermarkArtifact.artifactId,
          providerLogArchiveSha256: incompleteWatermarkArtifact.sha256,
        });
      assert.equal(
        incompleteWatermarkRes.status,
        422,
        "Must reject resolution when provider log watermark has not sealed past potential dispatch timeout",
      );
      assert.equal(
        problemBody(incompleteWatermarkRes).code,
        BILLING_ERROR_CODES.incompleteReconciliationWindow,
      );

      // Subcase 3C.4c: Future watermark (> current time) is strictly rejected
      const futureWatermarkArtifact =
        await artifactService.ingestVerifiedProviderLog(
          makeSignedArtifactParams({
            artifactId: `art-anthropic-future-watermark-${admission.invocationId}`,
            coverageStart,
            coverageEnd: new Date(nowMs + 3600_000),
            finalizedWatermark: new Date(nowMs + 3600_000), // In the future!
          }),
        );
      assert.equal(futureWatermarkArtifact.verified, true);
      const futureWatermarkRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...baseReconPayload,
          providerLogArtifactId: futureWatermarkArtifact.artifactId,
          providerLogArchiveSha256: futureWatermarkArtifact.sha256,
          providerLogCoverageEnd: new Date(nowMs + 3600_000).toISOString(),
        });
      assert.equal(
        futureWatermarkRes.status,
        422,
        "Must reject resolution when provider log watermark is in the future",
      );
      assert.equal(
        problemBody(futureWatermarkRes).code,
        BILLING_ERROR_CODES.incompleteReconciliationWindow,
      );

      // Subcase 3C.5: Valid comprehensive provider log verification succeeds with Admin authorization
      const validRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(baseReconPayload);

      assert.equal(validRes.status, 200);

      // Admission must be CONFIRMED_NO_USAGE and slot released
      const dbAdm = await prisma.billableInvocationAdmission.findUnique({
        where: { invocationId: admission.invocationId },
      });
      assert.equal(dbAdm?.state, ADMISSION_STATES.CONFIRMED_NO_USAGE);
      assert.equal(dbAdm?.maximumExposureMicrocredits, 0n);

      // BillingReconciliationCase must be CONFIRMED_NO_USAGE in DB
      const dbCase = await prisma.billingReconciliationCase.findUnique({
        where: { invocationId: admission.invocationId },
      });
      assert.ok(dbCase, "BillingReconciliationCase record must exist in DB");
      assert.equal(dbCase.state, "CONFIRMED_NO_USAGE");

      // Next admission request on wallet must now SUCCEED
      const freedRes = await requestAdmissionHelper("req-recon-freed-slot");
      assert.equal(freedRes.state, ADMISSION_STATES.ADMITTED);

      // Cancel freedRes so wallet slot is available for next scenario
      await httpRequest(app)
        .post("/internal/billing/admission/cancel")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionId: freedRes.admissionId,
          invocationId: freedRes.invocationId,
          capabilityToken: freedRes.capabilityToken,
          cancellationReason: "cleanup_freed_slot",
        });

      // -----------------------------------------------------------------------
      // Subcase 3C.6: Competing late settlement vs reconciliation decision
      // -----------------------------------------------------------------------
      // Scenario 1: Late settlement arrives AFTER reconciliation confirmed no usage
      // Late settlement must fail closed with 409 Conflict and NOT overwrite CONFIRMED_NO_USAGE
      const lateSettleAttempt = await httpRequest(app)
        .post("/internal/billing/usage/settle")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionId: admission.admissionId,
          invocationId: admission.invocationId,
          capabilityToken: admission.capabilityToken,
          attemptOrdinal: 1,
          providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
          inputTokens: 500,
          outputTokens: 50,
          totalTokens: 550,
        });
      assert.equal(
        lateSettleAttempt.status,
        409,
        "Late settlement must be rejected with 409 when reconciliation already closed as CONFIRMED_NO_USAGE",
      );
      assert.equal(
        problemBody(lateSettleAttempt).code,
        BILLING_ERROR_CODES.reconciliationAlreadyResolved,
      );

      // ADR-028 Line 157: Terminal precedence preserves CONFIRMED_NO_USAGE
      const dbAdmPreserved =
        await prisma.billableInvocationAdmission.findUnique({
          where: { invocationId: admission.invocationId },
        });
      assert.equal(dbAdmPreserved?.state, ADMISSION_STATES.CONFIRMED_NO_USAGE);
      assert.equal(dbAdmPreserved?.maximumExposureMicrocredits, 0n);

      // Durably committed to BillingReconciliationCase under INTEGRITY_REVIEW with conflictingPayload and conflictDetectedAt
      const dbCaseReview = await prisma.billingReconciliationCase.findUnique({
        where: { invocationId: admission.invocationId },
      });
      assert.ok(
        dbCaseReview,
        "BillingReconciliationCase record must exist in DB",
      );
      assert.equal(dbCaseReview.state, "INTEGRITY_REVIEW");
      assert.ok(
        dbCaseReview.conflictDetectedAt !== null,
        "conflictDetectedAt must be recorded",
      );
      assert.ok(
        dbCaseReview.conflictingPayload !== null,
        "conflictingPayload must be recorded",
      );
      const recordedConflict = dbCaseReview.conflictingPayload as Record<
        string,
        unknown
      >;
      assert.equal(recordedConflict.inputTokens, 500);
      assert.equal(recordedConflict.outputTokens, 50);

      // Wallet balance remains completely untouched (no ledger debit occurred)
      const walletAfter = await prisma.billingWallet.findUnique({
        where: { userId: customerUserId },
      });
      assert.equal(walletAfter?.balanceMicrocredits, 100_000_000n);

      // Scenario 2: Late settlement arrives BEFORE reconciliation decision
      // Create new invocation, move to DISPATCH_UNKNOWN, then settle it
      const lateSettledAdmission = await requestAdmissionHelper(
        "req-late-settle-first",
      );
      await consumeAdmissionHelper(lateSettledAdmission);

      // Move to DISPATCH_UNKNOWN
      await httpRequest(app)
        .post("/internal/billing/usage/settle")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionId: lateSettledAdmission.admissionId,
          invocationId: lateSettledAdmission.invocationId,
          capabilityToken: lateSettledAdmission.capabilityToken,
          attemptOrdinal: 1,
          providerCompletionState: PROVIDER_COMPLETION_STATES.OUTCOME_UNKNOWN,
        });

      // Late settlement arrives and wins: transitions to SETTLED
      const lateSettledRes = await httpRequest(app)
        .post("/internal/billing/usage/settle")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionId: lateSettledAdmission.admissionId,
          invocationId: lateSettledAdmission.invocationId,
          capabilityToken: lateSettledAdmission.capabilityToken,
          attemptOrdinal: 1,
          providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
          inputTokens: 200,
          outputTokens: 20,
          totalTokens: 220,
        });
      assert.equal(lateSettledRes.status, 200);

      // Backdate lateSettledAdmission so dispatch window is in the past
      await prisma.billableInvocationAdmission.update({
        where: { id: lateSettledAdmission.admissionId },
        data: {
          admittedAt: pastAdmittedAt,
          consumedAt: pastConsumedAt,
          expiresAt: pastExpiresAt,
        },
      });

      // Now Admin attempts to resolve as CONFIRMED_NO_USAGE on the settled invocation
      const lateReconArtifact = await artifactService.ingestVerifiedProviderLog(
        makeSignedArtifactParams({
          artifactId: `art-anthropic-late-recon-${lateSettledAdmission.invocationId}`,
          provider: "anthropic",
          coverageStart: new Date(nowMs - 4000_000),
          coverageEnd: new Date(nowMs - 1000),
          finalizedWatermark: new Date(nowMs - 1000),
          entries: [],
        }),
      );

      const lateReconRes = await httpRequest(app)
        .post("/admin/billing/reconciliation/resolve-no-usage")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          caseId: `case-${lateSettledAdmission.invocationId}`,
          invocationId: lateSettledAdmission.invocationId,
          provider: "anthropic",
          providerCorrelationId: `corr-${lateSettledAdmission.invocationId}`,
          providerLogArtifactId: lateReconArtifact.artifactId,
          providerLogArchiveSha256: lateReconArtifact.sha256,
          providerLogCoverageStart: new Date(nowMs - 4000_000).toISOString(),
          providerLogCoverageEnd: new Date(nowMs - 1000).toISOString(),
          auditRationale: "Late attempt to mark settled invocation as no usage",
        });

      assert.equal(
        lateReconRes.status,
        409,
        "Reconciliation resolve-no-usage must fail closed with 409 when admission was already SETTLED",
      );
      assert.equal(
        problemBody(lateReconRes).code,
        BILLING_ERROR_CODES.admissionAlreadySettled,
      );

      // Verify admission state remains SETTLED and was not overwritten
      const dbAdmSettled = await prisma.billableInvocationAdmission.findUnique({
        where: { invocationId: lateSettledAdmission.invocationId },
      });
      assert.equal(dbAdmSettled?.state, ADMISSION_STATES.SETTLED);
    } finally {
      delete process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE;
    }
  });

  // -------------------------------------------------------------------------
  // RED Test 3D: Pre-Consume Atomic Cancellation & Race Condition
  // -------------------------------------------------------------------------
  it("RED Test 3D: allows atomic pre-consume cancel, fails closed if already IN_FLIGHT, and serializes concurrent race", async () => {
    // Subcase 3D.1: Cancel before consume succeeds
    const admissionA = await requestAdmissionHelper(
      "req-cancel-pre-consume-success",
    );
    const cancelPayloadA: BillableInvocationCancelRequest = {
      admissionId: admissionA.admissionId,
      invocationId: admissionA.invocationId,
      capabilityToken: admissionA.capabilityToken,
      cancellationReason: "aborted_before_model_call",
    };

    const cancelResA = await httpRequest(app)
      .post("/internal/billing/admission/cancel")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(cancelPayloadA);

    assert.equal(cancelResA.status, 200);

    const dbAdmA = await prisma.billableInvocationAdmission.findUnique({
      where: { invocationId: admissionA.invocationId },
    });
    assert.equal(dbAdmA?.state, ADMISSION_STATES.CONFIRMED_NO_USAGE);
    assert.equal(dbAdmA?.maximumExposureMicrocredits, 0n);

    // Slot is immediately free
    const nextAdmA = await requestAdmissionHelper("req-cancel-freed-slot");
    assert.equal(nextAdmA.state, ADMISSION_STATES.ADMITTED);

    // Subcase 3D.2: Sequential cancel attempt after consume must fail closed with 409 Conflict
    await consumeAdmissionHelper(nextAdmA); // now IN_FLIGHT

    const cancelResB = await httpRequest(app)
      .post("/internal/billing/admission/cancel")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: nextAdmA.admissionId,
        invocationId: nextAdmA.invocationId,
        capabilityToken: nextAdmA.capabilityToken,
        cancellationReason: "late_abort_after_consume",
      });

    assert.equal(
      cancelResB.status,
      409,
      "Cancel must be rejected with 409 when admission is already IN_FLIGHT",
    );
    assert.equal(
      problemBody(cancelResB).code,
      BILLING_ERROR_CODES.admissionAlreadyInFlight,
    );

    // Concurrency slot must remain held
    const dbAdmB = await prisma.billableInvocationAdmission.findUnique({
      where: { invocationId: nextAdmA.invocationId },
    });
    assert.equal(dbAdmB?.state, ADMISSION_STATES.IN_FLIGHT);

    // Subcase 3D.3: Simultaneous race condition (cancel vs consume)
    // Settle nextAdmA first to free slot for race test
    await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: nextAdmA.admissionId,
        invocationId: nextAdmA.invocationId,
        capabilityToken: nextAdmA.capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      });

    const admissionRace = await requestAdmissionHelper(
      "req-cancel-consume-race",
    );
    const [cancelRaceRes, consumeRaceRes] = await Promise.all([
      httpRequest(app)
        .post("/internal/billing/admission/cancel")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionId: admissionRace.admissionId,
          invocationId: admissionRace.invocationId,
          capabilityToken: admissionRace.capabilityToken,
          cancellationReason: "simultaneous_cancel_race",
        }),
      httpRequest(app)
        .post("/internal/billing/admission/consume")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionId: admissionRace.admissionId,
          invocationId: admissionRace.invocationId,
          capabilityToken: admissionRace.capabilityToken,
        }),
    ]);

    // Exactly one operation must succeed (200), the other must fail (409 Conflict)
    const statuses = [cancelRaceRes.status, consumeRaceRes.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      "Exactly one of cancel or consume must win with 200, and loser gets 409",
    );

    const dbAdmRace = await prisma.billableInvocationAdmission.findUnique({
      where: { invocationId: admissionRace.invocationId },
    });

    if (consumeRaceRes.status === 200) {
      // Consume won: state must be IN_FLIGHT and concurrency slot remains held
      assert.equal(dbAdmRace?.state, ADMISSION_STATES.IN_FLIGHT);
      const blockedRaceAttempt = await httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionRequestId: "req-blocked-by-consume-race-win",
          logicalOperationId: "op-blocked-race",
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
        });
      assert.ok(
        blockedRaceAttempt.status === 429 || blockedRaceAttempt.status === 409,
      );
    } else {
      // Cancel won: state must be CONFIRMED_NO_USAGE and concurrency slot is freed
      assert.equal(dbAdmRace?.state, ADMISSION_STATES.CONFIRMED_NO_USAGE);
      const freeRaceAttempt = await requestAdmissionHelper(
        "req-freed-by-cancel-race-win",
      );
      assert.equal(freeRaceAttempt.state, ADMISSION_STATES.ADMITTED);
    }
  });

  // -------------------------------------------------------------------------
  // RED Test 4: Provider Timeout / Stream Disconnect -> OUTCOME_UNKNOWN
  // -------------------------------------------------------------------------
  it("RED Test 4: marks mid-stream timeout as OUTCOME_UNKNOWN, keeps slot blocked, and retains exposure", async () => {
    const admission = await requestAdmissionHelper("req-settle-stream-timeout");
    await consumeAdmissionHelper(admission);

    const timeoutPayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.OUTCOME_UNKNOWN,
      finishReason: "read_timeout_after_300s",
    };

    const res = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(timeoutPayload);

    assert.ok(res.status === 200 || res.status === 202);
    const body = successBody<BillableInvocationSettlementResponse>(res);
    assert.equal(body.settled, false);
    assert.equal(body.state, ADMISSION_STATES.OUTCOME_UNKNOWN);
    assert.equal(body.slotReleased, false);

    // Concurrency slot must remain BLOCKED
    const blockedRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-blocked-by-timeout-unknown",
        logicalOperationId: "op-blocked-timeout",
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
      });

    assert.ok(blockedRes.status === 429 || blockedRes.status === 409);
    assert.equal(
      problemBody(blockedRes).code,
      BILLING_ERROR_CODES.walletConcurrencyLimitExceeded,
    );
  });
});
