/**
 * WP8 Phase D Acceptance Tests: Production Debit, Atomic Commit, Recovery & Rollout Authority Pinning
 *
 * Rationale ("Why"): Implements Phase D RED acceptance tests defining the mandatory invariants
 * for live microcredit settlement debiting, atomic 5-record transactions under row locks,
 * signed outstanding balance handling, authority pinning (preventing retroactive debit of shadow admissions),
 * and financial-risk-contained recovery sweeps where concurrency slots remain held.
 *
 * Invariants & Constraints:
 * 1. Single Atomic Transaction: Under row lock FOR UPDATE on BillingWallet and BillableInvocationAdmission,
 *    live settlement commits exactly 5 records atomically: ModelUsageReceipt, CreditLedgerEntry,
 *    BillingWallet projection (signed balance), AuditEvent, and OutboxMessage. If any operation fails midway,
 *    all 5 records roll back completely.
 * 2. Authority Pinning (ADR-028 Line 123 & 208): An admission legitimately issued under SHADOW_SETTLEMENT authority
 *    can NEVER be retroactively debited even if the server is later switched to DEBIT_ENABLED authority;
 *    an admission issued under OFF can NEVER be retroactively upgraded to SHADOW or DEBIT_ENABLED.
 * 3. Signed Outstanding Balance (ADR-028 Line 140): An admitted invocation may settle into a negative balance
 *    because exposure was bounded before dispatch; negative balance blocks subsequent paid dispatches (402)
 *    without failing or rolling back the settled provider receipt.
 * 4. Idempotent Replay (ADR-028 Line 138): Replaying identical settlement payloads on a settled admission
 *    returns HTTP 200 without creating duplicate CreditLedgerEntry rows or deducting the wallet twice.
 * 5. Financial Risk Containment in Recovery (ADR-028 Line 92 & 155): When a worker crashes or an execution lease
 *    expires after CAS to IN_FLIGHT, the recovery sweeper transitions the invocation to DISPATCH_UNKNOWN,
 *    creates an OPEN BillingReconciliationCase, and strictly RETAINS the maximum financial exposure in the database,
 *    keeping the concurrency slot held until verified settlement or independent proof arrives.
 * 6. Physical Retry & Zero Redispatch (ADR-028 Line 70, 92, 220):
 *    - Unresolved attempts (IN_FLIGHT, DISPATCH_UNKNOWN, OUTCOME_UNKNOWN) strictly block attempt 2 (409 Conflict).
 *    - Settled operations strictly block further attempts (409 Conflict) even after slot release.
 *    - Operations that concluded in terminal non-usage (CONFIRMED_NO_USAGE, EXPIRED) permit attempt 2 with
 *      incremented attemptOrdinal, fresh admissionRequestId, and fresh physical invocationId.
 */

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
  ADMISSION_STATES,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  BILLING_INTEGRITY_REASONS,
  BILLING_ROLLOUT_MODES,
  CREDIT_LEDGER_SOURCES,
  MODEL_PRICING_SCOPES,
  MODEL_USAGE_DEBIT_MODES,
  PROVIDER_COMPLETION_STATES,
  RECONCILIATION_CASE_STATES,
  TOKEN_BUCKET_POLICIES,
  type BillableInvocationAdmissionRequest,
  type BillableInvocationAdmissionResponse,
  type BillableInvocationAdmissionConsume,
  type BillableInvocationSettlementRequest,
  type BillableInvocationSettlementResponse,
} from "@lcsp/contracts/billing";

import { AppModule } from "../src/app.module.js";
import { BillingRolloutAuthorityService } from "../src/modules/billing/application/shared/billing-rollout-authority.service.js";
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

describe("WP8 Phase D: Production Debit, Atomic Commit, Recovery & Rollout Authority Pinning (Postgres e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let rolloutAuthority: BillingRolloutAuthorityService;
  let customerUserId: string;
  let customerWalletId: string;
  let assessmentId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_TEST_API_KEY;
    process.env.BILLING_ADMISSION_MASTER_KEY = defaultMasterKey;

    await ensureMigratedSchema();
    ensureIdempotentMigrateDeploy();

    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    // Rationale ("Why"): To mathematically prove transaction atomicity under Postgres,
    // we install a trigger that aborts the transaction when correlationId === 'fail-atomic-midway'.
    // Mechanism ("How"): When AuditEvent is inserted inside the settlement $transaction, this trigger fires,
    // raising an exception and forcing PostgreSQL to abort the transaction.
    // Invariants: Verifies that preceding writes (ModelUsageReceipt, Admission updates) roll back completely.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION trg_test_simulate_atomic_rollback() RETURNS trigger AS $$
      BEGIN
        IF NEW."correlationId" = 'fail-atomic-midway' THEN
          RAISE EXCEPTION 'Simulated atomic rollback: failure midway through transaction';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_test_atomic_settlement ON "AuditEvent";
      CREATE TRIGGER trg_test_atomic_settlement
      BEFORE INSERT ON "AuditEvent"
      FOR EACH ROW EXECUTE FUNCTION trg_test_simulate_atomic_rollback();
    `);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    rolloutAuthority = app.get(BillingRolloutAuthorityService);
  });

  afterAll(async () => {
    delete process.env.MODEL_USAGE_DEBIT;
    if (prisma) {
      await prisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS trg_test_atomic_settlement ON "AuditEvent";
        DROP FUNCTION IF EXISTS trg_test_simulate_atomic_rollback();
      `);
      await prisma.$disconnect();
    }
    if (app) await app.close();
  });

  beforeEach(async () => {
    if (rolloutAuthority) {
      rolloutAuthority.setTestRolloutOverride(null);
    }

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "OutboxMessage",
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
    const seeded = await seedAuthWorkspaceFixture(prisma);
    customerUserId = seeded.approvedUser.id;

    const initialWallet = await prisma.billingWallet.create({
      data: {
        userId: customerUserId,
        availableCredits: 100n,
        balanceMicrocredits: 100_000_000n, // 100 credits = 100,000,000 microcredits
        accountingUnitVersion: 2,
        version: 1,
      },
    });
    customerWalletId = initialWallet.id;

    const assessment = await prisma.assessment.create({
      data: {
        id: `asm-phase-d-${Date.now()}`,
        name: "Phase D Production Debit & Recovery Assessment",
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
    const snapshot = await prisma.customerModelTariffSnapshot.create({
      data: {
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        normalizedScopeKey: "EXACT_MODEL:anthropic:claude-sonnet-4-6",
        version: 1,
        accountingUnitVersion: 2,
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        reasoningPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        idempotencyKey: `publish-phase-d-${Date.now()}`,
        requestFingerprint: "d".repeat(64),
        publishedBy: "system-test",
        auditReason: "Phase D E2E seed tariff",
      },
    });

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

    assert.equal(res.status, 201, `Failed to request admission: ${JSON.stringify(res.body)}`);
    return successBody<BillableInvocationAdmissionResponse>(res);
  }

  async function consumeAdmissionHelper(admission: BillableInvocationAdmissionResponse): Promise<void> {
    const consumePayload: BillableInvocationAdmissionConsume = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
    };

    const res = await httpRequest(app)
      .post("/internal/billing/admission/consume")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(consumePayload);

    assert.equal(res.status, 200, `Failed to consume admission: ${JSON.stringify(res.body)}`);
  }

  async function waitForBlockedLock(queryPattern: string, timeoutMs = 3000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rows = await prisma.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int as count
        FROM pg_locks l
        JOIN pg_stat_activity a ON l.pid = a.pid
        WHERE NOT l.granted 
          AND a.datname = current_database()
          AND a.query LIKE ${`%${queryPattern}%`};
      `;
      if (rows[0] && rows[0].count > 0) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // RED Test D1a: Transaction Atomicity & Failure Rollback under DEBIT_ENABLED
  // -------------------------------------------------------------------------
  it("RED Test D1a: rolls back all 5 records completely if a failure occurs midway through atomic settlement", async () => {
    // Set isolated test authority override without touching process.env or bypassing startup gate
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    // Request admission via legitimate issuance flow
    const admission = await requestAdmissionHelper("req-d1a-atomic-rollback");

    // Rationale ("Why"): Asserts legitimate authority issuance pipeline without manual database mutation.
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(dbAdm?.rolloutMode, BILLING_ROLLOUT_MODES.DEBIT_ENABLED, "Admission must be legitimately issued with DEBIT_ENABLED authority");
    assert.equal(dbAdm?.debitMode, MODEL_USAGE_DEBIT_MODES.ON, "Admission must be legitimately issued with debitMode ON");

    await consumeAdmissionHelper(admission);

    // Settle with injected mid-transaction failure trigger
    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      providerResponseId: "resp-d1a-rollback",
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .set("x-correlation-id", "fail-atomic-midway")
      .send(settlePayload);

    // Expect server error due to mid-transaction abort
    assert.equal(settleRes.status, 500, "Mid-transaction abort must return 500");

    // Atomicity Invariant Proof: ALL 5 records must roll back completely
    // 1. ModelUsageReceipt must NOT exist
    const receipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(receipt, null, "ModelUsageReceipt must be rolled back on midway failure");

    // 2. CreditLedgerEntry must NOT exist
    const ledgerEntry = await prisma.creditLedgerEntry.findFirst({
      where: { admissionId: admission.admissionId },
    });
    assert.equal(ledgerEntry, null, "CreditLedgerEntry must be rolled back on midway failure");

    // 3. BillingWallet balance must remain untouched (exactly 100,000,000n)
    const wallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.equal(wallet?.balanceMicrocredits, 100_000_000n, "BillingWallet balance must not be deducted on midway failure");

    // 4. AuditEvent for this settlement must NOT exist
    const audit = await prisma.auditEvent.findFirst({
      where: { resourceId: admission.admissionId, eventType: BILLING_AUDIT_EVENT_TYPES.usageSettled },
    });
    assert.equal(audit, null, "AuditEvent must be rolled back on midway failure");

    // 5. OutboxMessage must NOT exist
    const outbox = await prisma.outboxMessage.findFirst({
      where: { aggregateId: customerWalletId, eventType: BILLING_AUDIT_EVENT_TYPES.usageSettled },
    });
    assert.equal(outbox, null, "OutboxMessage must be rolled back on midway failure");

    // 6. Admission state must NOT be committed as SETTLED (must remain IN_FLIGHT)
    const dbAdmAfter = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(dbAdmAfter?.state, ADMISSION_STATES.IN_FLIGHT, "Admission must remain IN_FLIGHT after transaction rollback");
  });

  // -------------------------------------------------------------------------
  // RED Test D1b: Atomic 5-Record Commit on Success under DEBIT_ENABLED
  // -------------------------------------------------------------------------
  it("RED Test D1b: commits receipt, ledger, wallet projection, audit, and outbox atomically under DEBIT_ENABLED", async () => {
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    // Request admission via legitimate issuance flow
    const admission = await requestAdmissionHelper("req-d1b-atomic-debit");

    // Assert legitimate issuance authority (no manual database mutation)
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(dbAdm?.rolloutMode, BILLING_ROLLOUT_MODES.DEBIT_ENABLED, "Admission must be issued with DEBIT_ENABLED authority");
    assert.equal(dbAdm?.debitMode, MODEL_USAGE_DEBIT_MODES.ON, "Admission must be issued with debitMode ON");

    await consumeAdmissionHelper(admission);

    // 10k input (30,000) + 1k output (15,000) = 45,000 microcredits
    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      providerResponseId: "resp-d1b-live-debit",
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200);
    const body = successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(body.settled, true);
    assert.equal(body.debitMode, MODEL_USAGE_DEBIT_MODES.ON);
    assert.equal(body.calculatedMicrocredits, "45000");
    assert.equal(body.debitedMicrocredits, "45000");
    assert.equal(body.chargedMicrocredits, "45000");
    assert.equal(body.shadowMicrocredits, null);
    assert.equal(body.slotReleased, true);
    // Why: A successful ON settlement with remaining funds must not pause a healthy Assessment.
    // How: Verify the server-owned post-debit solvency result on the HTTP response.
    // Invariant: Worker code must not infer depletion from token usage or a pre-settlement balance.
    assert.equal((body as { paymentRequired?: boolean }).paymentRequired, false);

    // 1. Verify ModelUsageReceipt
    const receipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(receipt, "ModelUsageReceipt must exist");
    assert.equal((receipt as any).debitedMicrocredits, 45_000n);
    assert.equal((receipt as any).calculatedMicrocredits, 45_000n);

    // 2. Verify CreditLedgerEntry
    const ledgerEntry = await prisma.creditLedgerEntry.findFirst({
      where: {
        admissionId: admission.admissionId,
        ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT as any,
      },
    });
    assert.ok(ledgerEntry, "CreditLedgerEntry of source MODEL_USAGE_DEBIT must exist");
    assert.equal(ledgerEntry.deltaMicrocredits, -45_000n);
    assert.equal(ledgerEntry.walletId, customerWalletId);

    // 3. Verify BillingWallet projection deducted
    const wallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.equal(wallet?.balanceMicrocredits, 100_000_000n - 45_000n);

    // 4. Verify AuditEvent
    const audit = await prisma.auditEvent.findFirst({
      where: {
        resourceId: admission.admissionId,
        eventType: BILLING_AUDIT_EVENT_TYPES.usageSettled,
      },
    });
    assert.ok(audit, "AuditEvent for live debit must exist");
    assert.equal((audit.payload as any).debitedMicrocredits, "45000");

    // 5. Verify OutboxMessage
    const outbox = await prisma.outboxMessage.findFirst({
      where: {
        aggregateId: customerWalletId,
        eventType: BILLING_AUDIT_EVENT_TYPES.usageSettled,
      },
    });
    assert.ok(outbox, "OutboxMessage for usage settlement must be created in the same atomic transaction");
  });

  // -------------------------------------------------------------------------
  // RED Test D2a: Rollout Authority Pinning (SHADOW -> ON) - No Retroactive Upgrade
  // -------------------------------------------------------------------------
  it("RED Test D2a: refuses to retroactively debit admissions issued under SHADOW authority when server is ON", async () => {
    // 1. Admission issued when rolloutMode is SHADOW
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.SHADOW_SETTLEMENT,
      debitMode: MODEL_USAGE_DEBIT_MODES.SHADOW,
    });

    const admission = await requestAdmissionHelper("req-d2a-shadow-admission");
    await consumeAdmissionHelper(admission);

    // Rationale ("Why"): Test must verify what was actually pinned by the issuance handler.
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(
      dbAdm?.rolloutMode,
      BILLING_ROLLOUT_MODES.SHADOW_SETTLEMENT,
      "Admission must be legitimately pinned with SHADOW_SETTLEMENT authority at issuance",
    );
    assert.equal(
      dbAdm?.debitMode,
      MODEL_USAGE_DEBIT_MODES.SHADOW,
      "Admission must be legitimately pinned with debitMode SHADOW at issuance",
    );

    // 2. Server configuration authority is switched to DEBIT_ENABLED / ON
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    // 3. Settle invocation: Handler must inspect admission's pinned rolloutMode and REFUSE to debit
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
    assert.equal(body.settled, true);
    // Invariant: Must retain pinned SHADOW debitMode and 0 debited microcredits
    assert.equal(body.debitMode, MODEL_USAGE_DEBIT_MODES.SHADOW);
    assert.equal(body.debitedMicrocredits, "0");
    assert.equal(body.shadowMicrocredits, "45000");

    // Zero CreditLedgerEntry records created
    const ledgerCount = await prisma.creditLedgerEntry.count({
      where: { admissionId: admission.admissionId },
    });
    assert.equal(ledgerCount, 0, "No debit ledger entries allowed on shadow admissions");

    // Wallet balance untouched
    const wallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.equal(wallet?.balanceMicrocredits, 100_000_000n);
  });

  // -------------------------------------------------------------------------
  // RED Test D2b: Rollout Authority Pinning (OFF -> SHADOW) - No Retroactive Upgrade
  // -------------------------------------------------------------------------
  it("RED Test D2b: refuses to retroactively upgrade admissions issued under OFF authority when server switches to SHADOW", async () => {
    // 1. Admission issued when rolloutMode is OFF (ADMISSION_REQUIRED)
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
      debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
    });

    const admission = await requestAdmissionHelper("req-d2b-off-admission");
    await consumeAdmissionHelper(admission);

    // Verify pinned OFF authority
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(
      dbAdm?.rolloutMode,
      BILLING_ROLLOUT_MODES.ADMISSION_REQUIRED,
      "Admission must be pinned with ADMISSION_REQUIRED authority",
    );
    assert.equal(
      dbAdm?.debitMode,
      MODEL_USAGE_DEBIT_MODES.OFF,
      "Admission must be pinned with debitMode OFF",
    );

    // 2. Server configuration authority is switched to SHADOW
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.SHADOW_SETTLEMENT,
      debitMode: MODEL_USAGE_DEBIT_MODES.SHADOW,
    });

    // 3. Settle invocation: Handler must inspect admission's pinned debitMode: OFF and NOT upgrade to SHADOW
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
    assert.equal(body.settled, true);
    // Invariant: Must retain pinned OFF debitMode (shadowMicrocredits is null, debited is 0)
    assert.equal(body.debitMode, MODEL_USAGE_DEBIT_MODES.OFF);
    assert.equal(body.debitedMicrocredits, "0");
    assert.equal(body.shadowMicrocredits, null);

    // Zero CreditLedgerEntry records created
    const ledgerCount = await prisma.creditLedgerEntry.count({
      where: { admissionId: admission.admissionId },
    });
    assert.equal(ledgerCount, 0, "No debit ledger entries allowed on OFF admissions");

    // Wallet balance untouched
    const wallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.equal(wallet?.balanceMicrocredits, 100_000_000n);
  });

  // -------------------------------------------------------------------------
  // RED Test D3: Signed Outstanding Balance (Negative Balance Allowed for Admitted Invocations - ADR-028 Line 140)
  // -------------------------------------------------------------------------
  it("RED Test D3: settles admitted invocation into negative balance without rolling back provider receipt (ADR-028 Line 140)", async () => {
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    // Request admission with 30,000 exposure ceiling via legitimate issuance flow
    const admission = await requestAdmissionHelper("req-d3-negative-balance", {
      inputTokensUpperBound: 5_000, // 15,000 microcredits
      outputTokensUpperBound: 1_000, // 15,000 microcredits
    });

    // Assert legitimate issuance authority (no manual database update)
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(dbAdm?.rolloutMode, BILLING_ROLLOUT_MODES.DEBIT_ENABLED, "Admission must be issued with DEBIT_ENABLED authority");
    assert.equal(dbAdm?.debitMode, MODEL_USAGE_DEBIT_MODES.ON, "Admission must be issued with debitMode ON");

    await consumeAdmissionHelper(admission);

    // Simulate concurrent wallet drain before settlement arrives: wallet balance drops to only 5,000 microcredits
    await prisma.billingWallet.update({
      where: { id: customerWalletId },
      data: { balanceMicrocredits: 5_000n, availableCredits: 0n },
    });

    // Settle with 24,990 microcredits usage:
    // Balance before settlement: 5,000 microcredits.
    // Settled usage: 24,990 microcredits.
    // Expected balance after settlement: 5,000 - 24,990 = -19,990 microcredits (Signed Outstanding Balance).
    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 5_000, // 15,000
      outputTokens: 666,  // ~9,990
      totalTokens: 5_666,
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200, "Settlement must succeed into negative balance for admitted invocation");
    const body = successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(body.settled, true);
    assert.equal(body.slotReleased, true);
    // Why: The final physical call may consume the last credits with no later admission to return 402.
    // How: Assert the settlement response carries a server-owned depletion decision made under the wallet lock.
    // Invariant: The provider receipt remains settled while the worker receives a reason to checkpoint.
    assert.equal((body as { paymentRequired?: boolean }).paymentRequired, true);

    // Verify wallet holds negative balance
    const wallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.ok(wallet && wallet.balanceMicrocredits < 0n, "Wallet balance must be negative");
    const debitReceipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(debitReceipt?.paymentRequired, true, "Depletion must be pinned in the immutable settled receipt");

    // Next paid admission must be rejected with 402 PAYMENT_REQUIRED due to insolvent wallet
    const nextAdmissionRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d3-should-fail-402",
        logicalOperationId: "op-blocked-insolvent",
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

    assert.equal(nextAdmissionRes.status, 402, "Insolvent wallet with negative balance must reject new dispatches");

    // Why: A lost settlement response can be replayed after a customer has replenished the wallet.
    // How: Change only this disposable fixture's wallet balance, then replay the identical settled request.
    // Invariant: Replay returns the historical post-debit decision, never recomputes it from today's wallet balance.
    await prisma.billingWallet.update({
      where: { id: customerWalletId },
      data: { balanceMicrocredits: 50_000_000n, availableCredits: 50n },
    });
    const replayRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);
    assert.equal(replayRes.status, 200);
    const replayBody = successBody<BillableInvocationSettlementResponse>(replayRes);
    assert.equal(replayBody.paymentRequired, true);
  });

  // -------------------------------------------------------------------------
  // RED Test D4: Idempotent Replay Prevents Double-Debit (ADR-028 Line 138)
  // -------------------------------------------------------------------------
  it("RED Test D4: handles lost-response retry idempotently without duplicate CreditLedgerEntry or double-debiting wallet", async () => {
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    // Request admission via legitimate issuance flow
    const admission = await requestAdmissionHelper("req-d4-double-debit-prevention");

    // Assert legitimate issuance authority (no manual database update)
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(dbAdm?.rolloutMode, BILLING_ROLLOUT_MODES.DEBIT_ENABLED, "Admission must be issued with DEBIT_ENABLED authority");
    assert.equal(dbAdm?.debitMode, MODEL_USAGE_DEBIT_MODES.ON, "Admission must be issued with debitMode ON");

    await consumeAdmissionHelper(admission);

    const originalPayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      providerResponseId: "resp-d4-original",
    };

    // First settlement: debits 45,000 microcredits
    const firstRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(originalPayload);

    assert.equal(firstRes.status, 200);
    const initialWallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.equal(initialWallet?.balanceMicrocredits, 100_000_000n - 45_000n);

    // Lost-response retry with exact same payload
    const retryRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(originalPayload);

    assert.equal(retryRes.status, 200);
    const retryBody = successBody<BillableInvocationSettlementResponse>(retryRes);
    assert.equal(retryBody.settled, true);
    assert.equal(retryBody.debitedMicrocredits, "45000");

    // Must still have exactly 1 CreditLedgerEntry
    const ledgerCount = await prisma.creditLedgerEntry.count({
      where: { admissionId: admission.admissionId },
    });
    assert.equal(ledgerCount, 1, "Must not duplicate CreditLedgerEntry on idempotent replay");

    // Wallet balance must not be deducted twice
    const finalWallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.equal(finalWallet?.balanceMicrocredits, 100_000_000n - 45_000n);
  });

  // -------------------------------------------------------------------------
  // RED Test D5a: Recovery Sweeper Clock Isolation (Pre-consume TTL vs IN_FLIGHT Lease)
  // -------------------------------------------------------------------------
  it("RED Test D5a: sweeper does NOT sweep IN_FLIGHT invocation when only admission TTL (expiresAt) has expired but inFlightLeaseExpiresAt is active", async () => {
    const admission = await requestAdmissionHelper("req-d5a-active-in-flight-lease");
    await consumeAdmissionHelper(admission);

    // Admission TTL expired (e.g. 10 minutes ago), but in-flight lease is active for another 10 minutes
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.admissionId },
      data: {
        expiresAt: new Date(Date.now() - 600_000), // Pre-consume TTL expired 10m ago
        inFlightLeaseExpiresAt: new Date(Date.now() + 600_000), // IN_FLIGHT lease valid for +10m
      },
    });

    // Invoke recovery sweeper endpoint
    const sweepRes = await httpRequest(app)
      .post("/internal/billing/reconciliation/sweep-expired-leases")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({ batchSize: 50 });

    assert.equal(sweepRes.status, 200);

    // Invocation MUST REMAIN IN_FLIGHT: admission TTL does not prematurely sweep legitimate long model calls
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(
      dbAdm?.state,
      ADMISSION_STATES.IN_FLIGHT,
      "Admission must remain IN_FLIGHT while inFlightLeaseExpiresAt is in the future",
    );

    // No reconciliation case should be opened
    const reconCase = await prisma.billingReconciliationCase.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(reconCase, null, "No reconciliation case should be opened for active in-flight lease");
  });

  // -------------------------------------------------------------------------
  // RED Test D5b: Recovery Sweeper on Expired inFlightLeaseExpiresAt (ADR-028 Line 92, 155)
  // -------------------------------------------------------------------------
  it("RED Test D5b: sweeper transitions expired lease IN_FLIGHT invocation to DISPATCH_UNKNOWN when inFlightLeaseExpiresAt passes, opens reconciliation case, retains exposure, and keeps slot blocked", async () => {
    const admission = await requestAdmissionHelper("req-d5b-expired-lease-recovery");
    await consumeAdmissionHelper(admission);

    // Simulate worker crash: inFlightLeaseExpiresAt expired 5 minutes ago
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.admissionId },
      data: {
        consumedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 600_000),
        inFlightLeaseExpiresAt: new Date(Date.now() - 300_000), // IN_FLIGHT lease expired 5 minutes ago
      },
    });

    // Invoke recovery sweeper endpoint/command
    const sweepRes = await httpRequest(app)
      .post("/internal/billing/reconciliation/sweep-expired-leases")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({ batchSize: 50 });

    assert.equal(sweepRes.status, 200);

    // 1. Invocation must be transitioned to DISPATCH_UNKNOWN
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(dbAdm?.state, ADMISSION_STATES.DISPATCH_UNKNOWN);

    // 2. BillingReconciliationCase must be created in OPEN state
    const reconCase = await prisma.billingReconciliationCase.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(reconCase, "BillingReconciliationCase must be created when sweeping expired lease to DISPATCH_UNKNOWN");
    assert.equal(reconCase.state, RECONCILIATION_CASE_STATES.OPEN);
    assert.equal(reconCase.admissionId, admission.admissionId);
    // Why: Provider evidence is keyed by the dispatched correlation ID, which can differ from invocation ID.
    // How: The sweeper must copy the admission's correlation ID into the case used by Admin verification.
    // Invariant: Never accept a no-usage decision after looking up the wrong provider log identity.
    assert.equal(reconCase.providerCorrelationId, dbAdm?.correlationId);

    // 3. Financial exposure (maximumExposureMicrocredits) must remain strictly retained in DB
    assert.ok(
      dbAdm && dbAdm.maximumExposureMicrocredits > 0n,
      "Financial exposure (maximumExposureMicrocredits) must remain strictly retained on DISPATCH_UNKNOWN admission",
    );
    assert.equal(
      dbAdm?.maximumExposureMicrocredits.toString(),
      admission.maximumExposureMicrocredits,
      "Exposure ceiling must match originally admitted exposure without leakage or reduction",
    );

    // 4. Concurrency slot must REMAIN BLOCKED: next request fails with 409 Conflict
    const blockedRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d5b-should-be-blocked",
        logicalOperationId: "op-blocked-d5b",
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

    assert.equal(
      blockedRes.status,
      409,
      `Slot must remain held under DISPATCH_UNKNOWN after lease expiry sweep, got ${blockedRes.status}`,
    );
  });

  // -------------------------------------------------------------------------
  // RED Test D5c: Long-Running Call Past Minute 15 Stays Active under Approved Deadline / Heartbeat
  // -------------------------------------------------------------------------
  it("RED Test D5c: long-running model call remaining active past minute 15 is NOT swept when backed by approved execution deadline or heartbeat renewal", async () => {
    // 1. Setup AssessmentRuntime with approved execution deadline 35 minutes in future
    const approvedLeaseExpiresAt = new Date(Date.now() + 35 * 60 * 1000);
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: { leaseExpiresAt: approvedLeaseExpiresAt },
    });

    // 2. Request and consume admission
    const admission = await requestAdmissionHelper("req-d5c-long-running");
    await consumeAdmissionHelper(admission);

    // Verify inFlightLeaseExpiresAt inherited approved execution deadline (> 15 minutes!)
    const dbAdmInit = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.ok(dbAdmInit?.inFlightLeaseExpiresAt);
    assert.ok(
      dbAdmInit.inFlightLeaseExpiresAt.getTime() > Date.now() + 20 * 60 * 1000,
      "inFlightLeaseExpiresAt must inherit approved execution deadline beyond 15m",
    );

    // 3. Monotonicity Test: Heartbeat must NEVER shorten an existing deadline!
    // Current deadline is now + 35m. Sending heartbeat requesting 200s (3m20s) must NOT shorten the deadline!
    const shortHeartbeatRes = await httpRequest(app)
      .post("/internal/billing/admission/heartbeat")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        extensionSeconds: 200,
      });

    assert.equal(shortHeartbeatRes.status, 200);
    const shortHbBody = successBody<{
      admissionId: string;
      invocationId: string;
      state: string;
      inFlightLeaseExpiresAt: string;
    }>(shortHeartbeatRes);
    const shortHbExpiry = new Date(shortHbBody.inFlightLeaseExpiresAt).getTime();
    assert.ok(
      shortHbExpiry >= dbAdmInit.inFlightLeaseExpiresAt.getTime(),
      "Heartbeat requesting shorter duration must NOT truncate existing longer deadline",
    );

    // 4. Actual clock shift past minute 16:
    // Update DB timestamps so 16 minutes have physically elapsed:
    // - consumedAt is 16 minutes ago
    // - expiresAt (admission TTL) expired 11 minutes ago
    // - inFlightLeaseExpiresAt still has 19 minutes remaining (35 - 16 = 19m)
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.admissionId },
      data: {
        consumedAt: new Date(Date.now() - 16 * 60 * 1000),
        expiresAt: new Date(Date.now() - 11 * 60 * 1000),
        inFlightLeaseExpiresAt: new Date(Date.now() + 19 * 60 * 1000),
      },
    });

    const sweepResAt16m = await httpRequest(app)
      .post("/internal/billing/reconciliation/sweep-expired-leases")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({});

    assert.equal(sweepResAt16m.status, 200);

    // Admission must STILL be IN_FLIGHT (NOT swept to DISPATCH_UNKNOWN!)
    const dbAdmAt16m = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(
      dbAdmAt16m?.state,
      ADMISSION_STATES.IN_FLIGHT,
      "Active model call past minute 16 must NOT be swept while within approved inFlightLeaseExpiresAt",
    );

    // 5. Authority Ceiling Test: Heartbeat cannot extend after runtime authority expires
    // Simulate runtime execution authority expiring in the past
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: { leaseExpiresAt: new Date(Date.now() - 1000) },
    });

    const expiredAuthorityHbRes = await httpRequest(app)
      .post("/internal/billing/admission/heartbeat")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        extensionSeconds: 1200,
      });

    assert.equal(
      expiredAuthorityHbRes.status,
      403,
      "Heartbeat must be rejected with 403 Forbidden when runtime authority has expired",
    );

    // 6. Restore runtime authority and perform valid heartbeat extension
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: { leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const validHbRes = await httpRequest(app)
      .post("/internal/billing/admission/heartbeat")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        extensionSeconds: 1800,
      });

    assert.equal(validHbRes.status, 200, "Valid heartbeat extension must succeed with HTTP 200");

    // 7. When the extended deadline finally expires, sweeper correctly reclaims it to DISPATCH_UNKNOWN
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.admissionId },
      data: { inFlightLeaseExpiresAt: new Date(Date.now() - 5000) },
    });

    const sweepFinalRes = await httpRequest(app)
      .post("/internal/billing/reconciliation/sweep-expired-leases")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({});

    assert.equal(sweepFinalRes.status, 200);
    const dbAdmFinal = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(
      dbAdmFinal?.state,
      ADMISSION_STATES.DISPATCH_UNKNOWN,
      "Lease must transition to DISPATCH_UNKNOWN when extended deadline finally expires",
    );
  });

  // -------------------------------------------------------------------------
  // RED Test D5d: In-Flight Lease Bounded by 5-Minute Run Authority and Clamped on Heartbeat
  // -------------------------------------------------------------------------
  it("RED Test D5d: restricts in-flight lease to approved execution deadline when run has only 5 minutes remaining, and clamps heartbeat renewals", async () => {
    // 1. Setup AssessmentRuntime with approved execution deadline of exactly 5 minutes in future
    const fiveMinutesMs = 5 * 60 * 1000;
    const fiveMinuteDeadline = new Date(Date.now() + fiveMinutesMs);
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: { leaseExpiresAt: fiveMinuteDeadline },
    });

    // 2. Request and consume admission
    const admission = await requestAdmissionHelper("req-d5d-5min-run");
    await consumeAdmissionHelper(admission);

    // 3. Verify inFlightLeaseExpiresAt is bounded by the 5-minute approved deadline (NOT defaulted to 15m!)
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.ok(dbAdm?.inFlightLeaseExpiresAt, "inFlightLeaseExpiresAt must be recorded");
    const leaseRemainingMs = dbAdm.inFlightLeaseExpiresAt.getTime() - Date.now();
    assert.ok(
      leaseRemainingMs <= fiveMinutesMs + 3000,
      `In-flight lease must NOT exceed 5-minute run deadline (expected <= ${fiveMinutesMs + 3000}ms, got ${leaseRemainingMs}ms)`,
    );
    assert.ok(
      leaseRemainingMs >= fiveMinutesMs - 5000,
      `In-flight lease must inherit 5-minute run deadline (expected >= ${fiveMinutesMs - 5000}ms, got ${leaseRemainingMs}ms)`,
    );

    // 4. Heartbeat requesting 15 minutes (900s) must be CLAMPED to the 5-minute runtime ceiling
    const hbRes = await httpRequest(app)
      .post("/internal/billing/admission/heartbeat")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        extensionSeconds: 900,
      });

    assert.equal(hbRes.status, 200);
    const hbData = successBody<{ inFlightLeaseExpiresAt: string }>(hbRes);
    const hbRemainingMs = new Date(hbData.inFlightLeaseExpiresAt).getTime() - Date.now();
    assert.ok(
      hbRemainingMs <= fiveMinutesMs + 3000,
      `Heartbeat renewal must be clamped to 5-minute runtime ceiling (expected <= ${fiveMinutesMs + 3000}ms, got ${hbRemainingMs}ms)`,
    );

    // Restore runtime authority for subsequent tests
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: { leaseExpiresAt: new Date(Date.now() + 3600_000) },
    });
  });

  // -------------------------------------------------------------------------
  // RED Test D5e: Rejects Heartbeat (and Consume) When Execution Lease Token or Run Has Changed
  // -------------------------------------------------------------------------
  it("RED Test D5e: rejects heartbeat and consume with HTTP 403 when execution lease token or run has been replaced on AssessmentRuntime", async () => {
    // 1. Request and consume an admission under Run 1 (defaultRunId, defaultLeaseToken)
    const admission = await requestAdmissionHelper("req-d5e-replaced-run");
    await consumeAdmissionHelper(admission);

    // 2. Simulate Run 1 being superseded or replaced on AssessmentRuntime by Run 2
    const replacedRunId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const replacedLeaseToken = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: replacedRunId,
        leaseToken: replacedLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 45 * 60 * 1000), // Run 2 has active 45m lease!
      },
    });

    // 3. Worker from old Run 1 attempts to heartbeat its admission
    const oldWorkerHbRes = await httpRequest(app)
      .post("/internal/billing/admission/heartbeat")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        extensionSeconds: 600,
      });

    assert.equal(
      oldWorkerHbRes.status,
      403,
      "Heartbeat from superseded run must be rejected with 403 Forbidden even if assessment has active lease",
    );
    const hbProblem = problemBody(oldWorkerHbRes);
    assert.equal(hbProblem.code, BILLING_ERROR_CODES.admissionContextMismatch);

    // 4. Also verify consume fails closed if run is superseded before consume:
    // First, settle admission 1 to release the wallet concurrency slot
    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
        inputTokens: 100,
        outputTokens: 100,
        totalTokens: 200,
        providerResponseId: "resp-d5e-settle",
      });
    assert.equal(settleRes.status, 200);

    // Request admission under Run 2
    const adm2Res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d5e-run2-admission",
        logicalOperationId: "op-d5e-run2",
        attemptOrdinal: 1,
        runId: replacedRunId,
        assessmentId,
        executionLeaseToken: replacedLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 1000,
        outputTokensUpperBound: 1000,
      });
    assert.equal(adm2Res.status, 201);
    const adm2Data = successBody<BillableInvocationAdmissionResponse>(adm2Res);

    // Now replace AssessmentRuntime with Run 3 before adm2 is consumed
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: "11111111-1111-1111-1111-111111111111",
        leaseToken: "22222222-2222-2222-2222-222222222222",
        leaseExpiresAt: new Date(Date.now() + 45 * 60 * 1000),
      },
    });

    // Attempting to consume adm2 must now fail closed with 403 Forbidden
    const badConsumeRes = await httpRequest(app)
      .post("/internal/billing/admission/consume")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: adm2Data.admissionId,
        invocationId: adm2Data.invocationId,
        capabilityToken: adm2Data.capabilityToken,
      });
    assert.equal(
      badConsumeRes.status,
      403,
      "Consume on admission from replaced run must fail closed with 403 Forbidden",
    );
    const consumeProblem = problemBody(badConsumeRes);
    assert.equal(consumeProblem.code, BILLING_ERROR_CODES.admissionContextMismatch);

    // Restore runtime to default for downstream tests
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: defaultRunId,
        leaseToken: defaultLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
  });

  // -------------------------------------------------------------------------
  // RED Test D5f: Prevents Race When Execution Lease is Replaced During Consume (Never Transitions Old Admission to IN_FLIGHT)
  // -------------------------------------------------------------------------
  it("RED Test D5f: prevents race condition when execution lease is replaced during concurrent consume; rejects with 403 and keeps old admission out of IN_FLIGHT", async () => {
    // 1. Request an admission under Run 1 (defaultRunId, defaultLeaseToken)
    const admission = await requestAdmissionHelper("req-d5f-race");

    const replacedRunId = "77777777-7777-7777-7777-777777777777";
    const replacedLeaseToken = "88888888-8888-8888-8888-888888888888";

    // 2. Deliberate race: Start a transaction holding row lock on AssessmentRuntime,
    // update leaseToken to replacedLeaseToken, pause 150ms, then commit.
    // Concurrently invoke consume. Due to FOR SHARE lock on AssessmentRuntime,
    // consume MUST wait for the lease update to commit, read the new leaseToken, and fail closed with 403!
    const [leaseUpdateResult, consumeRaceRes] = await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "AssessmentRuntime"
          SET "currentExecutionId" = ${replacedRunId}::uuid,
              "leaseToken" = ${replacedLeaseToken}::uuid,
              "leaseExpiresAt" = NOW() + INTERVAL '45 minutes'
          WHERE "assessmentId" = ${assessmentId};
        `;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return "COMMITTED";
      }),
      (async () => {
        // Slight delay to ensure the transaction holds the lock first
        await new Promise((resolve) => setTimeout(resolve, 20));
        return httpRequest(app)
          .post("/internal/billing/admission/consume")
          .set("x-worker-api-key", WORKER_TEST_API_KEY)
          .send({
            admissionId: admission.admissionId,
            invocationId: admission.invocationId,
            capabilityToken: admission.capabilityToken,
          });
      })(),
    ]);

    assert.equal(leaseUpdateResult, "COMMITTED");
    assert.equal(
      consumeRaceRes.status,
      403,
      "Consume racing with lease replacement must fail closed with 403 Forbidden",
    );
    const problem = problemBody(consumeRaceRes);
    assert.equal(problem.code, BILLING_ERROR_CODES.admissionContextMismatch);

    // 3. Absolute Invariant Proof: The old admission must NEVER enter IN_FLIGHT!
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.notEqual(
      dbAdm?.state,
      ADMISSION_STATES.IN_FLIGHT,
      "Admission under superseded run must NEVER transition to IN_FLIGHT",
    );
    assert.equal(
      dbAdm?.state,
      ADMISSION_STATES.ADMITTED,
      "Admission must remain in unconsumed ADMITTED state",
    );

    // Restore runtime to default for downstream tests
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: defaultRunId,
        leaseToken: defaultLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
  });

  // -------------------------------------------------------------------------
  // RED Test D5g: clock_timestamp() Verification: Rejects Consume and Heartbeat When Lease Expires While Waiting for Row Lock (Without Token/Run ID Change)
  // -------------------------------------------------------------------------
  it("RED Test D5g: fails closed with HTTP 403 when execution lease expires while waiting for row lock without token or run ID change (consume rejected 403, heartbeat rejected 403)", async () => {
    // -----------------------------------------------------------------------
    // Part 1: Consume waiting for lock while lease expires without token change
    // -----------------------------------------------------------------------
    // 1. Set runtime lease to expire very shortly (in 150ms)
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: defaultRunId,
        leaseToken: defaultLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 150),
      },
    });

    const admConsume = await requestAdmissionHelper("req-d5g-consume-clock-drift");

    // 2. Deliberately hold row lock on AssessmentRuntime for 300ms using a deterministic lock acquisition signal
    let signalConsumeLockAcquired!: () => void;
    const consumeLockAcquired = new Promise<void>((resolve) => {
      signalConsumeLockAcquired = resolve;
    });

    const [consumeLockResult, consumeRes] = await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "assessmentId" FROM "AssessmentRuntime"
          WHERE "assessmentId" = ${assessmentId}
          FOR UPDATE;
        `;
        signalConsumeLockAcquired();
        // Hold lock past the 150ms expiry mark
        await new Promise((resolve) => setTimeout(resolve, 300));
        return "COMMITTED";
      }),
      (async () => {
        // Wait until background transaction actually holds the row lock (zero arbitrary setTimeout race)
        await consumeLockAcquired;
        return httpRequest(app)
          .post("/internal/billing/admission/consume")
          .set("x-worker-api-key", WORKER_TEST_API_KEY)
          .send({
            admissionId: admConsume.admissionId,
            invocationId: admConsume.invocationId,
            capabilityToken: admConsume.capabilityToken,
          });
      })(),
    ]);

    assert.equal(consumeLockResult, "COMMITTED");
    assert.equal(
      consumeRes.status,
      403,
      "Consume must fail closed with 403 Forbidden when lease expired while waiting for row lock",
    );
    const consumeProb = problemBody(consumeRes);
    assert.equal(consumeProb.code, BILLING_ERROR_CODES.admissionContextMismatch);

    // Verify admission NEVER entered IN_FLIGHT
    const dbAdmConsume = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admConsume.admissionId },
    });
    assert.notEqual(
      dbAdmConsume?.state,
      ADMISSION_STATES.IN_FLIGHT,
      "Admission must NOT enter IN_FLIGHT when lease expired during lock wait",
    );
    assert.equal(
      dbAdmConsume?.state,
      ADMISSION_STATES.ADMITTED,
      "Admission must remain in unconsumed ADMITTED state",
    );

    // -----------------------------------------------------------------------
    // Part 2: Heartbeat waiting for lock while lease expires without token change
    // -----------------------------------------------------------------------
    // 1. Restore runtime lease so we can request and consume a new admission
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        leaseExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    // Conclude admConsume to free wallet concurrency slot
    await prisma.billableInvocationAdmission.update({
      where: { id: admConsume.admissionId },
      data: {
        state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
        maximumExposureMicrocredits: 0n,
      },
    });

    const admHeartbeat = await requestAdmissionHelper("req-d5g-heartbeat-clock-drift");
    await consumeAdmissionHelper(admHeartbeat);

    // 2. Set runtime lease to expire in 150ms
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        leaseExpiresAt: new Date(Date.now() + 150),
      },
    });

    // 3. Deliberately hold row lock on AssessmentRuntime for 300ms using a deterministic lock acquisition signal
    let signalHbLockAcquired!: () => void;
    const hbLockAcquired = new Promise<void>((resolve) => {
      signalHbLockAcquired = resolve;
    });

    const [hbLockResult, heartbeatRes] = await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "assessmentId" FROM "AssessmentRuntime"
          WHERE "assessmentId" = ${assessmentId}
          FOR UPDATE;
        `;
        signalHbLockAcquired();
        // Hold lock past the 150ms expiry mark
        await new Promise((resolve) => setTimeout(resolve, 300));
        return "COMMITTED";
      }),
      (async () => {
        // Wait until background transaction actually holds the row lock (zero arbitrary setTimeout race)
        await hbLockAcquired;
        return httpRequest(app)
          .post("/internal/billing/admission/heartbeat")
          .set("x-worker-api-key", WORKER_TEST_API_KEY)
          .send({
            admissionId: admHeartbeat.admissionId,
            invocationId: admHeartbeat.invocationId,
            capabilityToken: admHeartbeat.capabilityToken,
            extensionSeconds: 900,
          });
      })(),
    ]);

    assert.equal(hbLockResult, "COMMITTED");
    assert.equal(
      heartbeatRes.status,
      403,
      "Heartbeat must fail closed with 403 Forbidden when lease expired while waiting for row lock",
    );
    const hbProb = problemBody(heartbeatRes);
    assert.equal(hbProb.code, BILLING_ERROR_CODES.admissionContextMismatch);

    // Settle admHeartbeat to leave clean state
    await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admHeartbeat.admissionId,
        invocationId: admHeartbeat.invocationId,
        capabilityToken: admHeartbeat.capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
        inputTokens: 100,
        outputTokens: 100,
        totalTokens: 200,
        providerResponseId: "resp-d5g-settle",
      });

    // Restore runtime to default for downstream tests
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: defaultRunId,
        leaseToken: defaultLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
  });

  // -------------------------------------------------------------------------
  // RED Test D5h: clock_timestamp() Verification: Re-evaluates Admission TTL (expiresAt) After Acquiring Authority Lock and Transitions to EXPIRED
  // -------------------------------------------------------------------------
  it("RED Test D5h: commits EXPIRED and returns HTTP 422 when admission TTL expires while waiting for AssessmentRuntime row lock", async () => {
    // 1. Ensure runtime has plenty of execution lease so only admission TTL expires
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        currentExecutionId: defaultRunId,
        leaseToken: defaultLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const admTtl = await requestAdmissionHelper("req-d5h-ttl-drift");

    // 2. Set admission expiresAt to expire in 500ms (sufficient buffer to prove request is waiting before expiry)
    const ttlExpiryTime = Date.now() + 500;
    await prisma.billableInvocationAdmission.update({
      where: { id: admTtl.admissionId },
      data: {
        expiresAt: new Date(ttlExpiryTime),
      },
    });

    // 3. Hold row lock on AssessmentRuntime using deterministic acquisition and confirmed lock blocking signal
    let signalLockAcquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });

    let isBlockedWaiting = false;
    let blockedAtTimestamp = 0;

    const [lockResult, consumeRes] = await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "assessmentId" FROM "AssessmentRuntime"
          WHERE "assessmentId" = ${assessmentId}
          FOR UPDATE;
        `;
        signalLockAcquired();

        // Wait until we confirm via pg_locks that consume is ACTIVELY BLOCKED waiting on this lock
        isBlockedWaiting = await waitForBlockedLock('FROM "AssessmentRuntime"');
        blockedAtTimestamp = Date.now();

        // Invariant: Consume MUST be confirmed waiting on lock BEFORE expiresAt has elapsed
        assert.ok(
          isBlockedWaiting,
          "Consume request must be confirmed blocked in PostgreSQL waiting for AssessmentRuntime lock",
        );
        assert.ok(
          blockedAtTimestamp < ttlExpiryTime,
          `Consume must be blocked on lock while TTL is still active: blockedAt=${blockedAtTimestamp}, ttlExpiryTime=${ttlExpiryTime}`,
        );

        // Now hold lock until expiresAt has definitively elapsed in PostgreSQL wall-clock time
        const waitRemaining = ttlExpiryTime - Date.now() + 80;
        if (waitRemaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitRemaining));
        }

        return "COMMITTED";
      }),
      (async () => {
        // Wait until background transaction holds the lock before firing HTTP request
        await lockAcquired;
        return httpRequest(app)
          .post("/internal/billing/admission/consume")
          .set("x-worker-api-key", WORKER_TEST_API_KEY)
          .send({
            admissionId: admTtl.admissionId,
            invocationId: admTtl.invocationId,
            capabilityToken: admTtl.capabilityToken,
          });
      })(),
    ]);

    assert.equal(lockResult, "COMMITTED");
    assert.equal(
      consumeRes.status,
      422,
      "Consume must return HTTP 422 when admission TTL expired while waiting for authority lock",
    );
    const consumeProb = problemBody(consumeRes);
    assert.equal(consumeProb.code, BILLING_ERROR_CODES.admissionExpired);

    // Verify admission was committed to EXPIRED in database via controlled commit pattern
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admTtl.admissionId },
    });
    assert.equal(
      dbAdm?.state,
      ADMISSION_STATES.EXPIRED,
      "Admission state must be committed as EXPIRED in the database",
    );
    assert.equal(dbAdm?.consumedAt, null, "consumedAt must remain null");
    assert.notEqual(
      dbAdm?.state,
      ADMISSION_STATES.IN_FLIGHT,
      "Admission must NEVER enter IN_FLIGHT when TTL expired during lock wait",
    );
  });

  // -------------------------------------------------------------------------
  // RED Test D5i: clock_timestamp() Verification: Rejects Consume on Fallback AssessmentDiscoveryRun When Lease Expires While Waiting for Row Lock
  // -------------------------------------------------------------------------
  it("RED Test D5i: fails closed with HTTP 403 when AssessmentDiscoveryRun lease expires while waiting for discovery run row lock", async () => {
    const discoveryRunId = randomUUID();
    const discoveryLeaseToken = randomUUID();

    // 1. Ensure AssessmentCase exists for foreign key constraint
    await prisma.assessmentCase.upsert({
      where: { assessmentId },
      create: { assessmentId },
      update: {},
    });

    // 2. Seed active AssessmentDiscoveryRun
    await prisma.assessmentDiscoveryRun.create({
      data: {
        runId: discoveryRunId,
        assessmentId,
        requestedBy: customerUserId,
        idempotencyKey: `idem-${discoveryRunId}`,
        requestDigest: `digest-${discoveryRunId}`,
        status: "RUNNING",
        attempt: 1,
        repositorySnapshotId: "snap-d5i",
        repositoryId: "repo-d5i",
        repositoryCommit: "commit-d5i",
        repositoryScanJobId: "job-d5i",
        threadId: "thread-d5i",
        leaseToken: discoveryLeaseToken,
        leaseExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    // 3. Request admission using the discovery run authority (AssessmentRuntime has defaultRunId, so fallback to discovery run is triggered)
    const admDiscovery = await requestAdmissionHelper("req-d5i-discovery-drift", {
      runId: discoveryRunId,
      executionLeaseToken: discoveryLeaseToken,
    });

    // 4. Set discovery run lease to expire in 500ms (sufficient buffer to prove request is waiting before expiry)
    const leaseExpiryTime = Date.now() + 500;
    await prisma.assessmentDiscoveryRun.update({
      where: { runId: discoveryRunId },
      data: {
        leaseExpiresAt: new Date(leaseExpiryTime),
      },
    });

    // 5. Hold row lock on AssessmentDiscoveryRun using deterministic acquisition and confirmed lock blocking signal
    let signalLockAcquired!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      signalLockAcquired = resolve;
    });

    let isBlockedWaiting = false;
    let blockedAtTimestamp = 0;

    const [lockResult, consumeRes] = await Promise.all([
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "runId" FROM "AssessmentDiscoveryRun"
          WHERE "runId" = ${discoveryRunId}::uuid
          FOR UPDATE;
        `;
        signalLockAcquired();

        // Wait until we confirm via pg_locks that consume is ACTIVELY BLOCKED waiting on AssessmentDiscoveryRun lock
        isBlockedWaiting = await waitForBlockedLock('FROM "AssessmentDiscoveryRun"');
        blockedAtTimestamp = Date.now();

        // Invariant: Consume MUST be confirmed waiting on lock BEFORE discovery leaseExpiresAt has elapsed
        assert.ok(
          isBlockedWaiting,
          "Consume request must be confirmed blocked in PostgreSQL waiting for AssessmentDiscoveryRun lock",
        );
        assert.ok(
          blockedAtTimestamp < leaseExpiryTime,
          `Consume must be blocked on discovery lock while lease is still active: blockedAt=${blockedAtTimestamp}, leaseExpiryTime=${leaseExpiryTime}`,
        );

        // Now hold lock until leaseExpiresAt has definitively elapsed in PostgreSQL wall-clock time
        const waitRemaining = leaseExpiryTime - Date.now() + 80;
        if (waitRemaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitRemaining));
        }

        return "COMMITTED";
      }),
      (async () => {
        // Wait until background transaction holds the lock before firing HTTP request
        await lockAcquired;
        return httpRequest(app)
          .post("/internal/billing/admission/consume")
          .set("x-worker-api-key", WORKER_TEST_API_KEY)
          .send({
            admissionId: admDiscovery.admissionId,
            invocationId: admDiscovery.invocationId,
            capabilityToken: admDiscovery.capabilityToken,
          });
      })(),
    ]);

    assert.equal(lockResult, "COMMITTED");
    assert.equal(
      consumeRes.status,
      403,
      "Consume must fail closed with 403 Forbidden when AssessmentDiscoveryRun lease expired during lock wait",
    );
    const consumeProb = problemBody(consumeRes);
    assert.equal(consumeProb.code, BILLING_ERROR_CODES.admissionContextMismatch);

    // Verify admission NEVER entered IN_FLIGHT
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admDiscovery.admissionId },
    });
    assert.notEqual(
      dbAdm?.state,
      ADMISSION_STATES.IN_FLIGHT,
      "Admission must NOT enter IN_FLIGHT when discovery run lease expired during lock wait",
    );
    assert.equal(
      dbAdm?.state,
      ADMISSION_STATES.ADMITTED,
      "Admission must remain in unconsumed ADMITTED state",
    );

    // Clean up discovery run fixture
    await prisma.assessmentDiscoveryRun.deleteMany({
      where: { runId: discoveryRunId },
    });
  });

  // -------------------------------------------------------------------------
  // RED Test D6a: Settles Late Receipt from DISPATCH_UNKNOWN & Forbids Attempt 2 for SETTLED Operations
  // -------------------------------------------------------------------------
  it("RED Test D6a: settles late provider receipt from DISPATCH_UNKNOWN, releases slot, and strictly forbids attempt 2 for settled operation", async () => {
    const logicalOpId = "op-req-d6a-late-receipt";
    const admission = await requestAdmissionHelper("req-d6a-late-receipt", {
      logicalOperationId: logicalOpId,
    });
    await consumeAdmissionHelper(admission);

    // Invocation was transitioned to DISPATCH_UNKNOWN by sweeper
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.admissionId },
      data: { state: ADMISSION_STATES.DISPATCH_UNKNOWN },
    });

    // Invariant: Recovery never re-dispatches a second physical provider call (ADR-028 Line 92, 220).
    // Late receipt arrives (e.g. worker revived cached response or provider callback delivered)
    const lateSettlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1, // original attempt ordinal, NO second dispatch
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      inputTokens: 4_000,
      outputTokens: 500,
      totalTokens: 4_500,
      providerResponseId: "resp-d6a-late-delivered",
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(lateSettlePayload);

    assert.equal(settleRes.status, 200);
    const body = successBody<BillableInvocationSettlementResponse>(settleRes);
    assert.equal(body.settled, true);
    assert.equal(body.state, ADMISSION_STATES.SETTLED);
    assert.equal(body.slotReleased, true);

    // =========================================================================
    // Proof of Zero Redispatch after Slot Release (ADR-028 Line 92, 220):
    // Even though the wallet concurrency slot is now FREE, any attempt by a worker
    // to request attempt 2 for the already settled logical operation MUST be rejected!
    // =========================================================================
    const attempt2AfterSettlementRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6a-second-attempt-after-settlement",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 2,
        runId: defaultRunId,
        assessmentId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });

    assert.equal(
      attempt2AfterSettlementRes.status,
      409,
      "Second dispatch attempt for the already settled logical operation must be rejected with 409 Conflict even when slot is free",
    );
    const problem = problemBody(attempt2AfterSettlementRes);
    assert.equal(
      problem.code,
      BILLING_ERROR_CODES.admissionAlreadySettled,
      "Rejection code must explicitly be admissionAlreadySettled",
    );

    // Assert dispatch boundary evidence in PostgreSQL:
    // 1. Exactly 1 physical admission exists for the logical operation across all attempts
    const admissionsForOperation = await prisma.billableInvocationAdmission.findMany({
      where: { logicalOperationId: logicalOpId },
    });
    assert.equal(
      admissionsForOperation.length,
      1,
      "Exactly 1 physical admission record may exist for the logical operation; zero second dispatches occurred",
    );
    assert.equal(
      admissionsForOperation[0].attemptOrdinal,
      1,
      "The single admitted dispatch must remain attemptOrdinal 1",
    );

    // 2. Exactly 1 ModelUsageReceipt exists, proving only 1 physical provider execution occurred and was billed
    const receipts = await prisma.modelUsageReceipt.findMany({
      where: { admissionId: admission.admissionId },
    });
    assert.equal(
      receipts.length,
      1,
      "Exactly 1 provider execution receipt may exist; no second provider call was dispatched or billed",
    );

    // 3. Concurrency slot is demonstrably FREE: a request for a NEW distinct logical operation succeeds
    const nextAdmission = await requestAdmissionHelper("req-d6a-next-request-free");
    assert.equal(
      nextAdmission.state,
      ADMISSION_STATES.ADMITTED,
      "New distinct logical operations succeed after slot release, proving the rejection of attempt 2 was due to zero-redispatch, not concurrency starvation",
    );
  });

  // -------------------------------------------------------------------------
  // RED Test D6b: Zero Redispatch while Prior Attempt is Unresolved (ADR-028 Line 92, 220)
  // -------------------------------------------------------------------------
  it("RED Test D6b: blocks physical attempt 2 when attempt 1 is unresolved (IN_FLIGHT, DISPATCH_UNKNOWN, or OUTCOME_UNKNOWN)", async () => {
    const logicalOpId = "op-d6b-unresolved-blocks-redispatch";

    // 1. Attempt 1 issued and consumed into IN_FLIGHT
    const adm1 = await requestAdmissionHelper("req-d6b-attempt-1", {
      logicalOperationId: logicalOpId,
      attemptOrdinal: 1,
    });
    await consumeAdmissionHelper(adm1);

    // Attempt 2 while Attempt 1 is IN_FLIGHT must be rejected
    const attempt2InFlightRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6b-attempt-2-while-inflight",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 2,
        runId: defaultRunId,
        assessmentId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });
    assert.equal(attempt2InFlightRes.status, 409, "Must reject attempt 2 while attempt 1 is IN_FLIGHT");
    assert.equal(problemBody(attempt2InFlightRes).code, BILLING_ERROR_CODES.concurrencyConflict);

    // 2. Attempt 1 transitions to DISPATCH_UNKNOWN (lease expiry / worker abort)
    await prisma.billableInvocationAdmission.update({
      where: { id: adm1.admissionId },
      data: { state: ADMISSION_STATES.DISPATCH_UNKNOWN },
    });

    const attempt2DispatchUnknownRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6b-attempt-2-while-dispatch-unknown",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 2,
        runId: defaultRunId,
        assessmentId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });
    assert.equal(attempt2DispatchUnknownRes.status, 409, "Must reject attempt 2 while attempt 1 is DISPATCH_UNKNOWN");
    assert.equal(problemBody(attempt2DispatchUnknownRes).code, BILLING_ERROR_CODES.concurrencyConflict);

    // 3. Attempt 1 transitions to OUTCOME_UNKNOWN (missing token evidence / timeout)
    await prisma.billableInvocationAdmission.update({
      where: { id: adm1.admissionId },
      data: { state: ADMISSION_STATES.OUTCOME_UNKNOWN },
    });

    const attempt2OutcomeUnknownRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6b-attempt-2-while-outcome-unknown",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 2,
        runId: defaultRunId,
        assessmentId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });
    assert.equal(attempt2OutcomeUnknownRes.status, 409, "Must reject attempt 2 while attempt 1 is OUTCOME_UNKNOWN");
    assert.equal(problemBody(attempt2OutcomeUnknownRes).code, BILLING_ERROR_CODES.concurrencyConflict);

    // Proof: Only attempt 1 ever exists in the database
    const allAdmissions = await prisma.billableInvocationAdmission.findMany({
      where: { logicalOperationId: logicalOpId },
    });
    assert.equal(allAdmissions.length, 1, "Zero second physical dispatches allowed while attempt 1 is unresolved");
  });

  // -------------------------------------------------------------------------
  // RED Test D6c: Physical Retry Allowed after Concluded Terminal Non-Usage (ADR-028 Line 70)
  // -------------------------------------------------------------------------
  it("RED Test D6c: permits physical attempt 2 with incremented attemptOrdinal when attempt 1 concluded in terminal non-usage (CONFIRMED_NO_USAGE or EXPIRED)", async () => {
    // Scope Note: This test directly updates state to CONFIRMED_NO_USAGE in DB to verify
    // downstream admission granting rules for subsequent physical attempts (monotonic attemptOrdinal and fresh invocationId).
    // It does not claim to prove the upstream independent no-usage verification/evidence pipeline.
    const logicalOpId = "op-d6c-terminal-non-usage-retry";

    // 1. Attempt 1 is requested
    const adm1 = await requestAdmissionHelper("req-d6c-attempt-1", {
      logicalOperationId: logicalOpId,
      attemptOrdinal: 1,
    });

    // Attempt 1 concludes in terminal CONFIRMED_NO_USAGE (e.g. pre-socket network error / socket never opened)
    await prisma.billableInvocationAdmission.update({
      where: { id: adm1.admissionId },
      data: {
        state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
        maximumExposureMicrocredits: 0n,
      },
    });

    // 2. Worker runtime (e.g. ModelRetryMiddleware) requests attempt 2 with incremented ordinal
    const attempt2Res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6c-attempt-2-valid-retry",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 2, // strictly incremented
        runId: defaultRunId,
        assessmentId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });

    assert.equal(attempt2Res.status, 201, "Fresh admission must be granted for legitimate attempt 2 retry");
    const adm2Body = successBody<BillableInvocationAdmissionResponse>(attempt2Res);
    assert.equal(adm2Body.state, ADMISSION_STATES.ADMITTED);
    assert.notEqual(adm2Body.invocationId, adm1.invocationId, "Attempt 2 must receive a fresh physical invocationId");

    // 3. Attempting to reuse attemptOrdinal: 1 or attemptOrdinal: 2 again is rejected
    const nonMonotonicRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6c-attempt-invalid-ordinal",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 2, // non-incremented
        runId: defaultRunId,
        assessmentId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });

    assert.equal(nonMonotonicRes.status, 409, "Must reject non-incremented attemptOrdinal for same logical operation");
    assert.equal(problemBody(nonMonotonicRes).code, BILLING_ERROR_CODES.idempotencyConflict);
  });

  // -------------------------------------------------------------------------
  // RED Test D6d: Attempt 1 in BILLING_INTEGRITY_REVIEW Blocks Attempt 2 (ADR-028 Line 138, 220)
  // -------------------------------------------------------------------------
  it("RED Test D6d: blocks physical attempt 2 when attempt 1 is in BILLING_INTEGRITY_REVIEW", async () => {
    const logicalOpId = "op-d6d-integrity-review-blocks-retry";

    // 1. Attempt 1 is requested and then enters BILLING_INTEGRITY_REVIEW
    const adm1 = await requestAdmissionHelper("req-d6d-attempt-1", {
      logicalOperationId: logicalOpId,
      attemptOrdinal: 1,
    });

    await prisma.billableInvocationAdmission.update({
      where: { id: adm1.admissionId },
      data: {
        state: ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
      },
    });

    // 2. Attempt 2 must be rejected with 409 Conflict (concurrencyConflict)
    // because attempt 1 is unresolved and holds financial risk under review
    const attempt2Res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6d-attempt-2",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 2,
        runId: defaultRunId,
        assessmentId,
        executionLeaseToken: defaultLeaseToken,
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });

    assert.equal(attempt2Res.status, 409, "Must reject attempt 2 while attempt 1 is in BILLING_INTEGRITY_REVIEW");
    assert.equal(problemBody(attempt2Res).code, BILLING_ERROR_CODES.concurrencyConflict);
  });

  // -------------------------------------------------------------------------
  // RED Test D6e: Two Concurrent Retries for Same Logical Operation Serialize & Exactly One Wins
  // -------------------------------------------------------------------------
  it("RED Test D6e: serializes concurrent retry requests for the same logicalOperationId so exactly one wins", async () => {
    const logicalOpId = "op-d6e-concurrent-retry-race";

    // 1. Attempt 1 concludes in terminal CONFIRMED_NO_USAGE
    const adm1 = await requestAdmissionHelper("req-d6e-attempt-1", {
      logicalOperationId: logicalOpId,
      attemptOrdinal: 1,
    });

    await prisma.billableInvocationAdmission.update({
      where: { id: adm1.admissionId },
      data: {
        state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
        maximumExposureMicrocredits: 0n,
      },
    });

    // 2. Two concurrent HTTP requests race to claim attempt 2
    const reqPayloadA = {
      admissionRequestId: "req-d6e-attempt-2-race-a",
      logicalOperationId: logicalOpId,
      attemptOrdinal: 2,
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

    const reqPayloadB = {
      admissionRequestId: "req-d6e-attempt-2-race-b",
      logicalOperationId: logicalOpId,
      attemptOrdinal: 2,
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

    const [resA, resB] = await Promise.all([
      httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send(reqPayloadA),
      httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send(reqPayloadB),
    ]);

    // Exactly one must succeed (201 Created), the other must be rejected (409 Conflict)
    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [201, 409], "Exactly one concurrent attempt must succeed and the other must 409");

    const winningRes = resA.status === 201 ? resA : resB;
    const losingRes = resA.status === 409 ? resA : resB;

    const winBody = successBody<BillableInvocationAdmissionResponse>(winningRes);
    assert.equal(winBody.state, ADMISSION_STATES.ADMITTED);

    const loseCode = problemBody(losingRes).code;
    assert.ok(
      loseCode === BILLING_ERROR_CODES.concurrencyConflict ||
        loseCode === BILLING_ERROR_CODES.idempotencyConflict,
      `Losing request must receive conflict error code, got: ${loseCode}`,
    );

    // Exactly one attempt 2 record must exist in the database
    const dbAttempts = await prisma.billableInvocationAdmission.findMany({
      where: { logicalOperationId: logicalOpId, attemptOrdinal: 2 },
    });
    assert.equal(dbAttempts.length, 1, "Exactly one DB record must be created for attempt 2");
  });

  // -------------------------------------------------------------------------
  // RED Test D6f: Concurrent Retries with Different AttemptOrdinals Serialize on Platform-Sponsored Work
  // -------------------------------------------------------------------------
  it("RED Test D6f: serializes concurrent retry requests with different attemptOrdinals (e.g. attempt 2 vs 3) so exactly one wins", async () => {
    const logicalOpId = "op-d6f-platform-concurrent-diff-ordinals";

    // 1. Ensure active PlatformSponsorshipPolicySnapshot exists
    await prisma.platformSponsorshipPolicySnapshot.upsert({
      where: {
        policyName_policyVersion_provider_resolvedModel: {
          policyName: "RULE_SET_PREPARATION_SYSTEM",
          policyVersion: "v1",
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
        },
      },
      update: {
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
      },
      create: {
        policyName: "RULE_SET_PREPARATION_SYSTEM",
        policyVersion: "v1",
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        effectiveFrom: new Date(Date.now() - 3600_000),
      },
    });

    // 2. Create SYSTEM-owned RuleSetPreparationRun (qualifies for platform sponsorship)
    const legalSource = await prisma.legalSourceVersion.create({
      data: {
        version: `fixture-d6f-${Date.now()}`,
        sourceManifest: {},
      },
    });

    const prepRun = await prisma.ruleSetPreparationRun.create({
      data: {
        legalSourceVersionId: legalSource.id,
        requestedBy: "SYSTEM",
        correlationId: "corr-d6f-platform-retry",
        idempotencyKey: `idemp-d6f-${Date.now()}`,
        targetActivityScope: "DEVELOPMENT_ONLY",
        executionState: "RUNNING",
      },
    });

    // 3. Attempt 1 is requested and concludes in terminal CONFIRMED_NO_USAGE
    const adm1Res = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d6f-attempt-1",
        logicalOperationId: logicalOpId,
        attemptOrdinal: 1,
        preparationRunId: prepRun.id,
        runId: prepRun.id,
        agentRole: "rule-preparer",
        operationType: "PREPARATION",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });

    assert.equal(adm1Res.status, 201);
    const adm1Body = successBody<BillableInvocationAdmissionResponse>(adm1Res);

    await prisma.billableInvocationAdmission.update({
      where: { id: adm1Body.admissionId },
      data: {
        state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
        maximumExposureMicrocredits: 0n,
      },
    });

    // 4. Two concurrent HTTP requests race for the same logicalOperationId with DIFFERENT attemptOrdinals (2 vs 3)
    const [resA, resB] = await Promise.all([
      httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionRequestId: "req-d6f-attempt-2-race-diff",
          logicalOperationId: logicalOpId,
          attemptOrdinal: 2, // Attempt 2
          preparationRunId: prepRun.id,
          runId: prepRun.id,
          agentRole: "rule-preparer",
          operationType: "PREPARATION",
          requestedProvider: "anthropic",
          requestedModel: "claude-sonnet-4-6",
          inputTokensUpperBound: 50_000,
          outputTokensUpperBound: 4096,
        }),
      httpRequest(app)
        .post("/internal/billing/admission/request")
        .set("x-worker-api-key", WORKER_TEST_API_KEY)
        .send({
          admissionRequestId: "req-d6f-attempt-3-race-diff",
          logicalOperationId: logicalOpId,
          attemptOrdinal: 3, // Attempt 3 (different ordinal!)
          preparationRunId: prepRun.id,
          runId: prepRun.id,
          agentRole: "rule-preparer",
          operationType: "PREPARATION",
          requestedProvider: "anthropic",
          requestedModel: "claude-sonnet-4-6",
          inputTokensUpperBound: 50_000,
          outputTokensUpperBound: 4096,
        }),
    ]);

    // Advisory lock guarantees transaction serialization: exactly one wins (201 Created), one is rejected (409 Conflict)
    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [201, 409], "Advisory lock must ensure exactly one concurrent retry succeeds and the other 409s");

    const winningRes = resA.status === 201 ? resA : resB;
    const losingRes = resA.status === 409 ? resA : resB;

    const winBody = successBody<BillableInvocationAdmissionResponse>(winningRes);
    assert.equal(winBody.state, ADMISSION_STATES.ADMITTED);

    const loseCode = problemBody(losingRes).code;
    assert.ok(
      loseCode === BILLING_ERROR_CODES.concurrencyConflict ||
        loseCode === BILLING_ERROR_CODES.idempotencyConflict,
      `Losing request must receive conflict code, got: ${loseCode}`,
    );

    // Total attempts in DB: attempt 1 (terminal non-usage) + exactly 1 newly granted admission!
    const allDbAttempts = await prisma.billableInvocationAdmission.findMany({
      where: { logicalOperationId: logicalOpId },
    });
    assert.equal(allDbAttempts.length, 2, "Database must contain exactly attempt 1 and the single winning attempt");
  });

  // -------------------------------------------------------------------------
  // RED Test D7: Lock Ordering & Wallet Version Increment (ADR-028 Line 145)
  // -------------------------------------------------------------------------
  it("RED Test D7: increments BillingWallet.version upon settlement debit under wallet-first row locking", async () => {
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    const initialWallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.ok(initialWallet);
    const initialVersion = initialWallet.version;

    const admission = await requestAdmissionHelper("req-d7-wallet-version-test");
    await consumeAdmissionHelper(admission);

    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      finishReason: "stop",
      responseStatus: "200",
      durationMs: 500,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      providerResponseId: "resp-d7-version",
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    assert.equal(settleRes.status, 200);

    // Verify wallet version is strictly incremented
    const updatedWallet = await prisma.billingWallet.findUnique({
      where: { id: customerWalletId },
    });
    assert.ok(updatedWallet);
    assert.equal(
      updatedWallet.version,
      initialVersion + 1,
      `BillingWallet.version must increment from ${initialVersion} to ${initialVersion + 1}`,
    );
  });

  // -------------------------------------------------------------------------
  // RED Test D8: Financial Record Consistency (accountingUnitVersion=2 & platform chargedMicrocredits=0)
  // -------------------------------------------------------------------------
  it("RED Test D8: writes accountingUnitVersion=2 to CreditLedgerEntry and enforces chargedMicrocredits=0 on PLATFORM_SPONSORED", async () => {
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    // 1. Customer wallet settlement check
    const custAdmission = await requestAdmissionHelper("req-d8-cust-accounting-version");
    await consumeAdmissionHelper(custAdmission);

    const custSettlePayload: BillableInvocationSettlementRequest = {
      admissionId: custAdmission.admissionId,
      invocationId: custAdmission.invocationId,
      capabilityToken: custAdmission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      finishReason: "stop",
      responseStatus: "200",
      durationMs: 400,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      providerResponseId: "resp-d8-cust",
    };

    const custSettleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(custSettlePayload);

    assert.equal(custSettleRes.status, 200);

    const ledgerEntry = await prisma.creditLedgerEntry.findFirst({
      where: { admissionId: custAdmission.admissionId },
    });
    assert.ok(ledgerEntry);
    assert.equal(
      ledgerEntry.accountingUnitVersion,
      2,
      "CreditLedgerEntry must use accountingUnitVersion=2 (microcredits)",
    );

    // 2. Platform sponsored settlement check
    // Ensure active PlatformSponsorshipPolicySnapshot exists
    await prisma.platformSponsorshipPolicySnapshot.upsert({
      where: {
        policyName_policyVersion_provider_resolvedModel: {
          policyName: "RULE_SET_PREPARATION_SYSTEM",
          policyVersion: "v1",
          provider: "anthropic",
          resolvedModel: "claude-sonnet-4-6",
        },
      },
      update: {
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
      },
      create: {
        policyName: "RULE_SET_PREPARATION_SYSTEM",
        policyVersion: "v1",
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        effectiveFrom: new Date(Date.now() - 3600_000),
      },
    });

    const legalSource = await prisma.legalSourceVersion.create({
      data: {
        version: `fixture-d8-${Date.now()}`,
        sourceManifest: {},
      },
    });

    const prepRun = await prisma.ruleSetPreparationRun.create({
      data: {
        legalSourceVersionId: legalSource.id,
        requestedBy: "SYSTEM",
        correlationId: "corr-d8-platform-sponsored",
        idempotencyKey: `idemp-d8-${Date.now()}`,
        targetActivityScope: "DEVELOPMENT_ONLY",
        executionState: "RUNNING",
      },
    });

    const platAdmissionRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d8-plat-sponsored",
        logicalOperationId: "op-d8-platform-sponsored",
        attemptOrdinal: 1,
        preparationRunId: prepRun.id,
        runId: prepRun.id,
        agentRole: "rule-preparer",
        operationType: "PREPARATION",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4096,
      });

    assert.equal(platAdmissionRes.status, 201);
    const platAdmBody = successBody<BillableInvocationAdmissionResponse>(platAdmissionRes);

    await consumeAdmissionHelper(platAdmBody);

    const platSettlePayload: BillableInvocationSettlementRequest = {
      admissionId: platAdmBody.admissionId,
      invocationId: platAdmBody.invocationId,
      capabilityToken: platAdmBody.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      finishReason: "stop",
      responseStatus: "200",
      durationMs: 300,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      providerResponseId: "resp-d8-plat",
    };

    const platSettleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(platSettlePayload);

    assert.equal(platSettleRes.status, 200);
    const platSettleBody = successBody<BillableInvocationSettlementResponse>(platSettleRes);

    // Platform sponsored must NEVER debit customer wallet: chargedMicrocredits and debitedMicrocredits must be 0!
    assert.equal(
      platSettleBody.debitedMicrocredits,
      "0",
      "PLATFORM_SPONSORED debitedMicrocredits must be 0",
    );
    assert.equal(
      platSettleBody.chargedMicrocredits,
      "0",
      "PLATFORM_SPONSORED chargedMicrocredits must be 0",
    );
    assert.equal(
      platSettleBody.calculatedMicrocredits,
      "45000",
      "PLATFORM_SPONSORED calculatedMicrocredits reflects actual rate calculation",
    );

    const platReceipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: platAdmBody.invocationId },
    });
    assert.ok(platReceipt);
    assert.equal(platReceipt.debitedMicrocredits, 0n);
    assert.equal(platReceipt.chargedMicrocredits, 0n);
    assert.equal(platReceipt.calculatedMicrocredits, 45_000n);
  });

  it("RED Test D8b: unsupported priced buckets on platform sponsorship retain exposure and open integrity review", async () => {
    // Why: A real provider can report cache or reasoning usage absent from the platform policy rate set.
    // How: Settle a platform admission with cached tokens and inspect the durable fail-closed outcome.
    // Invariant: Unknown pricing must not settle, release exposure, debit a wallet, or leave a bare 500 without a case.
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.SHADOW_SETTLEMENT,
      debitMode: MODEL_USAGE_DEBIT_MODES.SHADOW,
    });
    await prisma.platformSponsorshipPolicySnapshot.create({
      data: {
        policyName: "RULE_SET_PREPARATION_SYSTEM",
        policyVersion: "d8b",
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: 3_000_000n,
        outputMicrocreditsPerMillion: 15_000_000n,
        effectiveFrom: new Date(Date.now() - 3_600_000),
      },
    });
    const source = await prisma.legalSourceVersion.create({
      data: { version: `fixture-d8b-${Date.now()}`, sourceManifest: {} },
    });
    const prepRun = await prisma.ruleSetPreparationRun.create({
      data: {
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        correlationId: "corr-d8b-platform",
        idempotencyKey: `idemp-d8b-${Date.now()}`,
        targetActivityScope: "DEVELOPMENT_ONLY",
        executionState: "RUNNING",
      },
    });
    const admissionRes = await httpRequest(app)
      .post("/internal/billing/admission/request")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionRequestId: "req-d8b-platform",
        logicalOperationId: "op-d8b-platform",
        attemptOrdinal: 1,
        preparationRunId: prepRun.id,
        runId: prepRun.id,
        agentRole: "rule-preparer",
        operationType: "PREPARATION",
        requestedProvider: "anthropic",
        requestedModel: "claude-sonnet-4-6",
        inputTokensUpperBound: 50_000,
        outputTokensUpperBound: 4_096,
      });
    assert.equal(admissionRes.status, 201);
    const admission = successBody<BillableInvocationAdmissionResponse>(admissionRes);
    await consumeAdmissionHelper(admission);

    const settlementRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.admissionId,
        invocationId: admission.invocationId,
        capabilityToken: admission.capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
        finishReason: "stop",
        responseStatus: "200",
        durationMs: 300,
        inputTokens: 8_000,
        cachedInputTokens: 2_000,
        outputTokens: 1_000,
        totalTokens: 11_000,
        providerResponseId: "resp-d8b-platform",
      });
    assert.equal(settlementRes.status, 200);
    const result = successBody<BillableInvocationSettlementResponse>(settlementRes);
    assert.equal(result.settled, false);
    assert.equal(result.slotReleased, false);
    const storedAdmission = await prisma.billableInvocationAdmission.findUniqueOrThrow({
      where: { id: admission.admissionId },
    });
    assert.equal(storedAdmission.state, ADMISSION_STATES.OUTCOME_UNKNOWN);
    assert.ok(storedAdmission.maximumExposureMicrocredits > 0n);
    assert.equal(await prisma.modelUsageReceipt.findUnique({ where: { invocationId: admission.invocationId } }), null);
    const reconCase = await prisma.billingReconciliationCase.findUniqueOrThrow({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(reconCase.state, RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW);
    assert.equal(
      (reconCase.conflictingPayload as { reason?: string } | null)?.reason,
      BILLING_INTEGRITY_REASONS.unsupportedPricedBucket,
    );
  });

  // -------------------------------------------------------------------------
  // RED Test D9: Missing Wallet Must Fail Closed (ADR-028 Line 138, 145)
  // -------------------------------------------------------------------------
  it("RED Test D9: fails closed into BILLING_INTEGRITY_REVIEW when customer wallet cannot be found", async () => {
    rolloutAuthority.setTestRolloutOverride({
      rolloutMode: BILLING_ROLLOUT_MODES.DEBIT_ENABLED,
      debitMode: MODEL_USAGE_DEBIT_MODES.ON,
    });

    const admission = await requestAdmissionHelper("req-d9-missing-wallet");
    await consumeAdmissionHelper(admission);

    // Simulate database anomaly: walletId is pointed to nonexistent wallet
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "BillableInvocationAdmission" DISABLE TRIGGER ALL;
      UPDATE "BillableInvocationAdmission" SET "walletId" = '00000000-0000-0000-0000-000000000000' WHERE id = '${admission.admissionId}';
      ALTER TABLE "BillableInvocationAdmission" ENABLE TRIGGER ALL;
    `);

    const settlePayload: BillableInvocationSettlementRequest = {
      admissionId: admission.admissionId,
      invocationId: admission.invocationId,
      capabilityToken: admission.capabilityToken,
      attemptOrdinal: 1,
      providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
      finishReason: "stop",
      responseStatus: "200",
      durationMs: 500,
      inputTokens: 10_000,
      outputTokens: 1_000,
      totalTokens: 11_000,
      providerResponseId: "resp-d9-missing-wallet",
    };

    const settleRes = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(settlePayload);

    // Must fail closed with 422 Unprocessable Entity when wallet is missing!
    assert.equal(settleRes.status, 422, "Must fail closed with HTTP 422 if wallet is not found");

    // ModelUsageReceipt MUST NOT exist in SETTLED state
    const receipt = await prisma.modelUsageReceipt.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.equal(receipt, null, "Must NOT persist ModelUsageReceipt if wallet is missing");

    // Admission MUST be committed in BILLING_INTEGRITY_REVIEW state in PostgreSQL
    const dbAdm = await prisma.billableInvocationAdmission.findUnique({
      where: { id: admission.admissionId },
    });
    assert.equal(
      dbAdm?.state,
      ADMISSION_STATES.BILLING_INTEGRITY_REVIEW,
      "Admission must be persisted in BILLING_INTEGRITY_REVIEW state in PostgreSQL",
    );
    assert.ok(
      dbAdm && dbAdm.maximumExposureMicrocredits > 0n,
      "Maximum exposure must be retained to keep slot blocked",
    );

    // BillingReconciliationCase MUST be committed in database with state INTEGRITY_REVIEW
    const reconCase = await prisma.billingReconciliationCase.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(
      reconCase,
      "BillingReconciliationCase must be persisted in database when wallet is missing",
    );
    assert.equal(
      reconCase.state,
      RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW,
      "Reconciliation case must be persisted in INTEGRITY_REVIEW state",
    );
  });
});
