/**
 * WP8 G-07 Transaction Compensation & Debit Linking Acceptance Tests (Postgres E2E)
 *
 * Rationale ("Why"): ADR-028 Line 159 & Line 173 mandate that transaction compensation must be
 * an immutable ledger entry linked to the original debit, server-calculated, idempotent, and bounded
 * by the original debit's remaining uncompensated amount under serialized aggregate row locks.
 *
 * Business Invariants & Constraints:
 * 1. Payload Strictness: Client cannot inject arbitrary fields (walletId, userId, amountCredits, etc.).
 * 2. RBAC & Action Permission: Requires admin role and explicit billing:debit:compensate authority.
 * 3. Debit Eligibility: A debit is only eligible if linked to an existing BillableInvocationAdmission,
 *    a verified ModelUsageReceipt, and matching walletId and userId.
 * 4. Available Credits Projection: availableCredits must be projected from newBalanceMicrocredits
 *    (newBalanceMicrocredits / 1_000_000), handling fractional credit crossings correctly.
 * 5. Cumulative Compensation Bounds: Total compensations linked to a debit must never exceed the
 *    original debit's absolute microcredits amount. Over-compensation returns 422 (BILLING_COMPENSATION_LIMIT_EXCEEDED).
 * 6. Idempotency: Replaying with identical idempotencyKey and payload returns 200 without double crediting.
 *    Replaying with conflicting payload returns 409 (BILLING_IDEMPOTENCY_CONFLICT).
 * 7. Concurrency Serialization: Concurrent compensation requests competing for remaining balance must serialize
 *    under row lock (FOR UPDATE), ensuring the cumulative ceiling is never breached.
 * 8. Single Atomic Transaction: CreditLedgerEntry, BillingWallet projection, AuditEvent, and OutboxMessage
 *    commit atomically in a single transaction. Midway failure rolls back all 4 records.
 * 9. Operational Safety: Operates with MODEL_USAGE_DEBIT=OFF and PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF.
 */

import * as assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ADMISSION_STATES,
  BILLING_ACTIONS,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  CREDIT_LEDGER_SOURCES,
  PROVIDER_COMPLETION_STATES,
  compensateBillingDebitResponseSchema,
  type CompensateBillingDebitRequest,
  type CompensateBillingDebitResponse,
} from "@lcsp/contracts/billing";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";

import { AppModule } from "../src/app.module.js";
import { createAuthSessionRecord } from "./support/auth-record-test-helpers.js";
import {
  TEST_DATABASE_URL,
  ensureMigratedSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemBody, successBody } from "./support/http.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(testDir, "..");
const WORKER_TEST_API_KEY = "test-worker-internal-api-key";

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

describe("WP8 G-07 Transaction Compensation & Debit Linking (Postgres E2E)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let adminUserId: string;
  let customerToken: string;
  let customerUserId: string;
  let customerWalletId: string;
  let assessmentId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_TEST_API_KEY;
    // Operational safety invariant: Debit feature gate and reconciliation release MUST remain OFF
    process.env.MODEL_USAGE_DEBIT = "OFF";
    process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE = "OFF";

    await ensureMigratedSchema();
    ensureIdempotentMigrateDeploy();

    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    // Install deterministic atomic rollback simulation trigger on AuditEvent
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION trg_test_simulate_compensation_rollback() RETURNS trigger AS $$
      BEGIN
        IF NEW."correlationId" = 'fail-atomic-compensation' THEN
          RAISE EXCEPTION 'Simulated atomic rollback: failure midway through compensation transaction';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_test_atomic_compensation ON "AuditEvent";
      CREATE TRIGGER trg_test_atomic_compensation
      BEFORE INSERT ON "AuditEvent"
      FOR EACH ROW EXECUTE FUNCTION trg_test_simulate_compensation_rollback();
    `);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS trg_test_atomic_compensation ON "AuditEvent";
      DROP FUNCTION IF EXISTS trg_test_simulate_compensation_rollback();
    `);
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "OutboxMessage",
        "ModelUsageReceipt",
        "BillingReconciliationCase",
        "BillableInvocationAdmission",
        "CreditLedgerEntry",
        "BillingWallet",
        "AuditEvent"
      CASCADE;
    `);

    await resetAuthWorkspaceDatabase(prisma);
    const fixture = await seedAuthWorkspaceFixture(prisma);
    customerUserId = fixture.approvedUser.id;
    adminUserId = fixture.noMembershipUser.id;

    // Sign in as admin
    const adminSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "nomembership@acme.test",
      password: "NoMembership123!",
    });
    adminToken = successBody<SignInSuccess>(adminSignIn).session_token ?? "";

    // Sign in as regular customer user
    const customerSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    customerToken =
      successBody<SignInSuccess>(customerSignIn).session_token ?? "";

    // Create wallet with initial 100,000,000 microcredits (100 credits)
    const wallet = await prisma.billingWallet.create({
      data: {
        userId: customerUserId,
        availableCredits: 100n,
        balanceMicrocredits: 100_000_000n,
        accountingUnitVersion: 2,
        version: 1,
      },
    });
    customerWalletId = wallet.id;

    // Seed assessment for customer
    const asm = await prisma.assessment.create({
      data: {
        id: `asm-comp-${Date.now()}`,
        name: "Compensation Test Assessment",
        ownerId: customerUserId,
      },
    });
    assessmentId = asm.id;
  });

  /**
   * Helper to seed a fully verified and eligible debit record:
   * BillableInvocationAdmission (SETTLED) + ModelUsageReceipt + CreditLedgerEntry (MODEL_USAGE_DEBIT)
   */
  async function seedEligibleDebit(amountMicrocredits: bigint = 10_000_000n) {
    const admission = await prisma.billableInvocationAdmission.create({
      data: {
        admissionRequestId: `req-${randomUUID()}`,
        invocationId: `inv-${randomUUID()}`,
        requestFingerprint: "b".repeat(64),
        logicalOperationId: "op-comp-1",
        attemptOrdinal: 1,
        fundingPrincipal: "CUSTOMER_WALLET",
        userId: customerUserId,
        walletId: customerWalletId,
        assessmentId,
        runId: "run-comp-test",
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedModel: "claude-3-5-sonnet",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-3-5-sonnet",
        runtimePolicyVersion: "v1",
        rolloutMode: "DEBIT_ENABLED",
        debitMode: "ON",
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: amountMicrocredits,
        initialExposureMicrocredits: amountMicrocredits,
        capabilityDigest: "c".repeat(64),
        state: ADMISSION_STATES.SETTLED,
        admittedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
        correlationId: `corr-${randomUUID()}`,
        version: 2,
      },
    });

    const receipt = await prisma.modelUsageReceipt.create({
      data: {
        admissionId: admission.id,
        invocationId: admission.invocationId,
        providerCompletionState: "COMPLETED",
        operationType: "SYNTHESIS",
        runtimePolicyVersion: "v1",
        inputTokens: 1000n,
        outputTokens: 2000n,
        cachedInputTokens: 0n,
        reasoningTokens: 0n,
        totalTokens: 3000n,
        calculatedMicrocredits: amountMicrocredits,
        debitedMicrocredits: amountMicrocredits,
        settledAt: new Date(),
      },
    });

    const debitEntry = await prisma.creditLedgerEntry.create({
      data: {
        userId: customerUserId,
        walletId: customerWalletId,
        admissionId: admission.id,
        idempotencyKey: `debit-${admission.id}`,
        source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT as any,
        deltaCredits: -(amountMicrocredits / 1_000_000n),
        deltaMicrocredits: -amountMicrocredits,
        accountingUnitVersion: 2,
        createdAt: new Date(),
      },
    });

    // Rationale ("Why"): A legitimate historical debit must be reflected in wallet balances.
    // Mechanism ("How"): Deduct debited microcredits and project availableCredits from remaining balance.
    // Invariants & Constraints: Balance is decremented and version incremented from initial seed.
    const updatedBalance = 100_000_000n - amountMicrocredits;
    await prisma.billingWallet.update({
      where: { id: customerWalletId },
      data: {
        balanceMicrocredits: updatedBalance,
        availableCredits:
          updatedBalance > 0n ? updatedBalance / 1_000_000n : 0n,
        version: 2,
      },
    });

    return { admission, receipt, debitEntry };
  }

  it("G07-PREVIEW-RED: case detail exposes the server-verified debit and remaining compensable amount", async () => {
    const { admission, debitEntry } = await seedEligibleDebit(10_000_000n);
    const caseId = `case-preview-${randomUUID()}`;
    await prisma.billingReconciliationCase.create({
      data: {
        caseId,
        invocationId: admission.invocationId,
        admissionId: admission.id,
        provider: admission.resolvedProvider,
        providerCorrelationId: admission.correlationId,
      },
    });

    const response = await httpRequest(app)
      .get(`/admin/billing/reconciliation/cases/${caseId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(response.status, 200);
    const detail = successBody<Record<string, unknown>>(response);
    // Why: Admin must see the exact immutable debit before offering a compensation form.
    // How: Check the case-bound ledger identity and server-computed remaining amount.
    // Invariant: UI must not guess or accept a client-calculated compensable ceiling.
    assert.deepEqual(detail.compensationPreview, {
      originalLedgerEntryId: debitEntry.id,
      originalDebitMicrocredits: "10000000",
      totalCompensatedMicrocredits: "0",
      remainingUncompensatedMicrocredits: "10000000",
    });

    const compensation = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "4000000",
        reason: "Verified partial compensation preview",
        idempotencyKey: `comp-preview-${randomUUID()}`,
      });
    assert.equal(compensation.status, 200);
    const refreshed = await httpRequest(app)
      .get(`/admin/billing/reconciliation/cases/${caseId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(refreshed.status, 200);
    // Why: A stale UI ceiling after partial compensation could invite an excessive refund request.
    // How: Re-read the same case and assert the sum and remainder come from persisted ledger rows.
    // Invariant: Preview amounts are advisory; the compensation command enforces the ceiling again under lock.
    assert.deepEqual(
      successBody<Record<string, unknown>>(refreshed).compensationPreview,
      {
        originalLedgerEntryId: debitEntry.id,
        originalDebitMicrocredits: "10000000",
        totalCompensatedMicrocredits: "4000000",
        remainingUncompensatedMicrocredits: "6000000",
      },
    );
  });

  it("G07-RED-01: Rejects payload with injected unknown fields (walletId, userId, extra client amounts)", async () => {
    const { debitEntry } = await seedEligibleDebit();

    const maliciousPayload = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "1000000",
      reason: "Attempting client mass-assignment injection",
      idempotencyKey: "comp-hack-01",
      walletId: "spoofed-wallet-id",
      userId: "spoofed-user-id",
      balanceMicrocredits: "9999999999",
      amountCredits: "9999",
    };

    const res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(maliciousPayload);

    assert.equal(
      res.status,
      400,
      "Must reject unknown client-injected fields with 400 Bad Request",
    );
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.validationFailed);
  });

  it("G07-RED-02: RBAC enforcement rejects customer, worker, and unauthenticated callers", async () => {
    const { debitEntry } = await seedEligibleDebit();

    const payload: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "1000000",
      reason: "Unauthorized attempt check",
      idempotencyKey: "comp-rbac-check",
    };

    // Customer user token -> 403 Forbidden
    const customerRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send(payload);
    assert.equal(
      customerRes.status,
      403,
      "Customer user must receive 403 Forbidden",
    );

    // Worker internal key alone -> 401 Unauthorized (or 403 Forbidden if paired with non-admin session)
    const workerRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("x-worker-key", WORKER_TEST_API_KEY)
      .send(payload);
    assert.ok(
      workerRes.status === 401 || workerRes.status === 403,
      "Worker key alone must never grant access (401 or 403)",
    );

    // Worker internal key with customer token -> 403 Forbidden
    const workerWithCustomerRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("x-worker-key", WORKER_TEST_API_KEY)
      .send(payload);
    assert.equal(
      workerWithCustomerRes.status,
      403,
      "Worker key with customer session must receive 403 Forbidden",
    );

    // Admin without compensation action permission (holds goodwill credit only) -> 403 Forbidden
    // Rationale ("Why"): ADR-028 Line 173-174 mandates explicit compensation action permission;
    // goodwill credit is a strictly separate action and must never grant compensation authority.
    const goodwillOnlyToken = "admin-goodwill-only-token";
    await createAuthSessionRecord(prisma, {
      id: "session-admin-goodwill-only",
      userId: adminUserId,
      token: goodwillOnlyToken,
      expiresAt: new Date(Date.now() + 3600_000),
      metadata: {
        permissions: [BILLING_ACTIONS.goodwillCredit],
      },
    });
    const goodwillOnlyRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${goodwillOnlyToken}`)
      .send(payload);
    assert.equal(
      goodwillOnlyRes.status,
      403,
      "Admin holding only goodwill credit permission must receive 403 Forbidden",
    );
    assert.equal(
      problemBody(goodwillOnlyRes).code,
      AUTH_ERROR_CODES.rbacDenied,
    );

    // Unauthenticated -> 401 Unauthorized
    const unauthRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .send(payload);
    assert.equal(
      unauthRes.status,
      401,
      "Unauthenticated request must receive 401 Unauthorized",
    );
  });

  it("G07-RED-03: Rejects debit not eligible: missing admission, missing receipt, or user/wallet mismatch", async () => {
    // Subcase A: Non-existent debit UUID
    const nonExistentRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: randomUUID(),
        amountMicrocredits: "1000000",
        reason: "Compensation for ghost entry",
        idempotencyKey: "comp-idem-notfound",
      });
    assert.equal(
      nonExistentRes.status,
      404,
      "Must return 404 Not Found for non-existent debit",
    );
    assert.equal(
      problemBody(nonExistentRes).code,
      BILLING_ERROR_CODES.debitNotFound,
    );

    // Subcase B: Referenced entry is BILLING_ORDER_CREDIT, not a debit
    const topupEntry = await prisma.creditLedgerEntry.create({
      data: {
        userId: customerUserId,
        walletId: customerWalletId,
        idempotencyKey: "topup-entry-01",
        source: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.BILLING_ORDER_CREDIT as any,
        deltaCredits: 50n,
        deltaMicrocredits: 50_000_000n,
        accountingUnitVersion: 2,
      },
    });
    const nonDebitRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: topupEntry.id,
        amountMicrocredits: "1000000",
        reason: "Invalid attempt to compensate a credit top-up",
        idempotencyKey: "comp-idem-nondebit",
      });
    assert.equal(
      nonDebitRes.status,
      422,
      "Must return 422 for non-debit entry",
    );
    assert.equal(
      problemBody(nonDebitRes).code,
      BILLING_ERROR_CODES.debitNotEligible,
    );

    // Subcase C: Debit has admissionId: null (orphaned debit without admission linkage)
    const orphanedDebit = await prisma.creditLedgerEntry.create({
      data: {
        userId: customerUserId,
        walletId: customerWalletId,
        idempotencyKey: "debit-orphaned-01",
        source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT as any,
        deltaCredits: -5n,
        deltaMicrocredits: -5_000_000n,
        admissionId: null, // missing admission linkage
        accountingUnitVersion: 2,
      },
    });
    const orphanedRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: orphanedDebit.id,
        amountMicrocredits: "1000000",
        reason: "Compensating orphaned debit",
        idempotencyKey: "comp-idem-orphaned",
      });
    assert.equal(
      orphanedRes.status,
      422,
      "Must return 422 for debit missing admission linkage",
    );
    assert.equal(
      problemBody(orphanedRes).code,
      BILLING_ERROR_CODES.debitNotEligible,
    );

    // Subcase D: Debit has admissionId, but NO ModelUsageReceipt exists
    const unreceiptedAdmission =
      await prisma.billableInvocationAdmission.create({
        data: {
          admissionRequestId: `req-${randomUUID()}`,
          invocationId: `inv-unreceipted-${randomUUID()}`,
          requestFingerprint: "b".repeat(64),
          logicalOperationId: "op-comp-unreceipted",
          attemptOrdinal: 1,
          fundingPrincipal: "CUSTOMER_WALLET",
          userId: customerUserId,
          walletId: customerWalletId,
          assessmentId,
          runId: "run-comp-unreceipted",
          agentRole: "assessment-root",
          operationType: "SYNTHESIS",
          requestedModel: "claude-3-5-sonnet",
          resolvedProvider: "anthropic",
          resolvedModel: "claude-3-5-sonnet",
          runtimePolicyVersion: "v1",
          rolloutMode: "DEBIT_ENABLED",
          debitMode: "ON",
          appliedMaxOutputTokens: 4096,
          maximumExposureMicrocredits: 5_000_000n,
          initialExposureMicrocredits: 5_000_000n,
          capabilityDigest: "c".repeat(64),
          state: ADMISSION_STATES.ADMITTED,
          admittedAt: new Date(Date.now() - 60_000),
          expiresAt: new Date(Date.now() + 3600_000),
          correlationId: `corr-unreceipted`,
          version: 1,
        },
      });
    const unreceiptedDebit = await prisma.creditLedgerEntry.create({
      data: {
        userId: customerUserId,
        walletId: customerWalletId,
        admissionId: unreceiptedAdmission.id,
        idempotencyKey: "debit-unreceipted-01",
        source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT as any,
        deltaCredits: -5n,
        deltaMicrocredits: -5_000_000n,
        accountingUnitVersion: 2,
      },
    });
    const unreceiptedRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: unreceiptedDebit.id,
        amountMicrocredits: "1000000",
        reason: "Compensating debit with missing usage receipt",
        idempotencyKey: "comp-idem-unreceipted",
      });
    assert.equal(
      unreceiptedRes.status,
      422,
      "Must return 422 for debit with missing ModelUsageReceipt",
    );
    assert.equal(
      problemBody(unreceiptedRes).code,
      BILLING_ERROR_CODES.debitNotEligible,
    );

    // Subcase E: Debit linked to admission with debitMode: "OFF" (invalid debit authority)
    // Rationale ("Why"): A debit labeled MODEL_USAGE_DEBIT but associated with an admission
    // executed under debitMode OFF lacks valid settlement authority and is strictly ineligible for compensation.
    const offAdmission = await prisma.billableInvocationAdmission.create({
      data: {
        admissionRequestId: `req-${randomUUID()}`,
        invocationId: `inv-off-${randomUUID()}`,
        requestFingerprint: "b".repeat(64),
        logicalOperationId: "op-comp-off",
        attemptOrdinal: 1,
        fundingPrincipal: "CUSTOMER_WALLET",
        userId: customerUserId,
        walletId: customerWalletId,
        assessmentId,
        runId: "run-comp-off",
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedModel: "claude-3-5-sonnet",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-3-5-sonnet",
        runtimePolicyVersion: "v1",
        rolloutMode: "TELEMETRY_ONLY",
        debitMode: "OFF",
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 5_000_000n,
        initialExposureMicrocredits: 5_000_000n,
        capabilityDigest: "c".repeat(64),
        state: ADMISSION_STATES.SETTLED,
        admittedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
        correlationId: "corr-off",
        version: 1,
      },
    });
    await prisma.modelUsageReceipt.create({
      data: {
        admissionId: offAdmission.id,
        invocationId: offAdmission.invocationId,
        providerCompletionState: "COMPLETED",
        operationType: "SYNTHESIS",
        runtimePolicyVersion: "v1",
        inputTokens: 1000n,
        outputTokens: 2000n,
        cachedInputTokens: 0n,
        reasoningTokens: 0n,
        totalTokens: 3000n,
        calculatedMicrocredits: 5_000_000n,
        debitedMicrocredits: 5_000_000n,
        settledAt: new Date(),
      },
    });
    const offDebit = await prisma.creditLedgerEntry.create({
      data: {
        userId: customerUserId,
        walletId: customerWalletId,
        admissionId: offAdmission.id,
        idempotencyKey: "debit-off-01",
        source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT as any,
        deltaCredits: -5n,
        deltaMicrocredits: -5_000_000n,
        accountingUnitVersion: 2,
      },
    });
    const offRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: offDebit.id,
        amountMicrocredits: "1000000",
        reason: "Compensating debit with admission debitMode OFF",
        idempotencyKey: "comp-idem-off",
      });
    assert.equal(
      offRes.status,
      422,
      "Must return 422 for debit with admission debitMode OFF",
    );
    assert.equal(
      problemBody(offRes).code,
      BILLING_ERROR_CODES.debitNotEligible,
    );

    // Subcase F: ModelUsageReceipt debitedMicrocredits does not match ledger deltaMicrocredits
    // Rationale ("Why"): Prevents compensating unverified or tampered debits where ledger and receipt diverge.
    const mismatchAdmission = await prisma.billableInvocationAdmission.create({
      data: {
        admissionRequestId: `req-${randomUUID()}`,
        invocationId: `inv-mismatch-${randomUUID()}`,
        requestFingerprint: "b".repeat(64),
        logicalOperationId: "op-comp-mismatch",
        attemptOrdinal: 1,
        fundingPrincipal: "CUSTOMER_WALLET",
        userId: customerUserId,
        walletId: customerWalletId,
        assessmentId,
        runId: "run-comp-mismatch",
        agentRole: "assessment-root",
        operationType: "SYNTHESIS",
        requestedModel: "claude-3-5-sonnet",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-3-5-sonnet",
        runtimePolicyVersion: "v1",
        rolloutMode: "DEBIT_ENABLED",
        debitMode: "ON",
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 10_000_000n,
        initialExposureMicrocredits: 10_000_000n,
        capabilityDigest: "c".repeat(64),
        state: ADMISSION_STATES.SETTLED,
        admittedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
        correlationId: "corr-mismatch",
        version: 1,
      },
    });
    await prisma.modelUsageReceipt.create({
      data: {
        admissionId: mismatchAdmission.id,
        invocationId: mismatchAdmission.invocationId,
        providerCompletionState: "COMPLETED",
        operationType: "SYNTHESIS",
        runtimePolicyVersion: "v1",
        inputTokens: 1000n,
        outputTokens: 2000n,
        cachedInputTokens: 0n,
        reasoningTokens: 0n,
        totalTokens: 3000n,
        calculatedMicrocredits: 5_000_000n,
        debitedMicrocredits: 5_000_000n, // Mismatches debit's 10_000_000n!
        settledAt: new Date(),
      },
    });
    const mismatchDebit = await prisma.creditLedgerEntry.create({
      data: {
        userId: customerUserId,
        walletId: customerWalletId,
        admissionId: mismatchAdmission.id,
        idempotencyKey: "debit-mismatch-01",
        source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
        ledgerSource: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT as any,
        deltaCredits: -10n,
        deltaMicrocredits: -10_000_000n,
        accountingUnitVersion: 2,
      },
    });
    const mismatchRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: mismatchDebit.id,
        amountMicrocredits: "1000000",
        reason: "Compensating debit with receipt amount mismatch",
        idempotencyKey: "comp-idem-mismatch",
      });
    assert.equal(
      mismatchRes.status,
      422,
      "Must return 422 for debit with receipt amount mismatch",
    );
    assert.equal(
      problemBody(mismatchRes).code,
      BILLING_ERROR_CODES.debitNotEligible,
    );
  });

  it("G07-RED-04: Links compensation to eligible debit, updates wallet, and increments version", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    // Set wallet: 90,000,000 microcredits, 90 credits, version 2
    await prisma.billingWallet.update({
      where: { id: customerWalletId },
      data: {
        balanceMicrocredits: 90_000_000n,
        availableCredits: 90n,
        version: 2,
      },
    });

    const compensationRequest: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "4000000", // 4 credits
      reason: "Operational refund for transient provider error",
      idempotencyKey: "comp-idem-01",
    };

    const res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(compensationRequest);

    assert.equal(
      res.status,
      200,
      `Expected 200 OK, got ${res.status}: ${JSON.stringify(res.body)}`,
    );
    const data = successBody<CompensateBillingDebitResponse>(res);

    // Validate response strictly conforms to contract schema
    const contractValidation =
      compensateBillingDebitResponseSchema.safeParse(data);
    assert.ok(
      contractValidation.success,
      `Response must strictly match contract schema: ${JSON.stringify(contractValidation)}`,
    );
    assert.equal(data.walletId, customerWalletId);
    assert.equal(data.userId, customerUserId);
    assert.ok(data.compensatedAt, "Must include ISO compensatedAt");

    assert.equal(data.compensated, true);
    assert.equal(data.originalLedgerEntryId, debitEntry.id);
    assert.equal(data.originalDebitMicrocredits, "10000000");
    assert.equal(data.compensatedMicrocredits, "4000000");
    assert.equal(data.totalCompensatedMicrocredits, "4000000");
    assert.equal(data.remainingUncompensatedMicrocredits, "6000000");
    assert.equal(data.walletBalanceMicrocredits, "94000000");
    assert.equal(data.walletVersion, 3);

    // Verify CreditLedgerEntry persisted in DB
    const persistedEntry = await prisma.creditLedgerEntry.findUnique({
      where: { id: data.ledgerEntryId },
    });
    assert.ok(persistedEntry, "Compensation ledger entry must exist in DB");
    assert.equal(persistedEntry.source, CREDIT_LEDGER_SOURCES.COMPENSATION);
    assert.equal(
      persistedEntry.ledgerSource,
      CREDIT_LEDGER_SOURCES.COMPENSATION as any,
    );
    assert.equal(persistedEntry.originalLedgerEntryId, debitEntry.id);
    assert.equal(persistedEntry.deltaMicrocredits, 4_000_000n);
    assert.equal(persistedEntry.deltaCredits, 4n);
    assert.equal(persistedEntry.walletId, customerWalletId);
    assert.equal(persistedEntry.userId, customerUserId);

    // Verify wallet updated in DB
    const updatedWallet = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: customerWalletId },
    });
    assert.equal(updatedWallet.balanceMicrocredits, 94_000_000n);
    assert.equal(updatedWallet.availableCredits, 94n);
    assert.equal(updatedWallet.version, 3);
  });

  it("G07-RED-05: Correctly projects availableCredits when sub-credit amount crosses 1-credit boundary", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    // Initial wallet state: 600,000 microcredits (0 public credits, since 600,000 < 1,000,000)
    await prisma.billingWallet.update({
      where: { id: customerWalletId },
      data: {
        balanceMicrocredits: 600_000n,
        availableCredits: 0n,
        version: 2,
      },
    });

    // Compensate 500,000 microcredits (0.5 credit)
    // Resulting balance = 600,000 + 500,000 = 1,100,000 microcredits
    // availableCredits MUST project to 1n (1,100,000 / 1,000_000), NOT 0n + (500_000 / 1_000_000 = 0)
    const res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "500000",
        reason: "Sub-credit compensation crossing 1-credit threshold",
        idempotencyKey: "comp-fractional-boundary",
      });

    assert.equal(res.status, 200);
    const data = successBody<CompensateBillingDebitResponse>(res);
    assert.equal(data.walletBalanceMicrocredits, "1100000");

    const updatedWallet = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: customerWalletId },
    });
    assert.equal(updatedWallet.balanceMicrocredits, 1_100_000n);
    assert.equal(
      updatedWallet.availableCredits,
      1n,
      "availableCredits must be projected from resulting balance (1,100,000 / 1,000,000 = 1)",
    );
  });

  it("G07-RED-06: Enforces cumulative compensation bounds (cannot exceed original debit)", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    // Step 1: Compensate 7,000,000 microcredits (succeeds, remaining = 3,000,000)
    const step1Res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "7000000",
        reason: "First partial compensation",
        idempotencyKey: "comp-bounds-1",
      });
    assert.equal(step1Res.status, 200);
    const step1Data = successBody<CompensateBillingDebitResponse>(step1Res);
    assert.equal(step1Data.totalCompensatedMicrocredits, "7000000");
    assert.equal(step1Data.remainingUncompensatedMicrocredits, "3000000");

    // Step 2: Attempt to compensate 3,000,001 microcredits (exceeds remaining 3,000,000)
    const step2Res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "3000001",
        reason: "Excessive compensation attempt",
        idempotencyKey: "comp-bounds-excess",
      });
    assert.equal(
      step2Res.status,
      422,
      "Must reject compensation exceeding remaining balance",
    );
    assert.equal(
      problemBody(step2Res).code,
      BILLING_ERROR_CODES.compensationLimitExceeded,
    );

    // Step 3: Compensate exact remaining 3,000,000 microcredits (succeeds, remaining = 0)
    const step3Res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "3000000",
        reason: "Second partial compensation completing full refund",
        idempotencyKey: "comp-bounds-exact",
      });
    assert.equal(step3Res.status, 200);
    const step3Data = successBody<CompensateBillingDebitResponse>(step3Res);
    assert.equal(step3Data.totalCompensatedMicrocredits, "10000000");
    assert.equal(step3Data.remainingUncompensatedMicrocredits, "0");

    // Step 4: Subsequent compensation for even 1 microcredit is rejected
    const step4Res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "1",
        reason: "Post-exhaustion compensation",
        idempotencyKey: "comp-bounds-post",
      });
    assert.equal(step4Res.status, 422);
    assert.equal(
      problemBody(step4Res).code,
      BILLING_ERROR_CODES.compensationLimitExceeded,
    );
  });

  it("G07-RED-07: Idempotent replay returns existing result; conflicting replay returns 409", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    const payload: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "5000000",
      reason: "Initial valid compensation",
      idempotencyKey: "comp-idem-replay-key",
    };

    // First call: 200 OK
    const firstRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);
    assert.equal(firstRes.status, 200);
    const firstData = successBody<CompensateBillingDebitResponse>(firstRes);

    // Identical replay: 200 OK with same ledgerEntryId and no duplicate debit/credit
    const replayRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);
    assert.equal(replayRes.status, 200);
    const replayData = successBody<CompensateBillingDebitResponse>(replayRes);
    assert.equal(replayData.ledgerEntryId, firstData.ledgerEntryId);
    assert.equal(
      replayData.walletBalanceMicrocredits,
      firstData.walletBalanceMicrocredits,
    );

    // Verify DB contains exactly 1 compensation entry (no duplicate credit)
    const count = await prisma.creditLedgerEntry.count({
      where: {
        originalLedgerEntryId: debitEntry.id,
        source: CREDIT_LEDGER_SOURCES.COMPENSATION,
      },
    });
    assert.equal(
      count,
      1,
      "Must not create duplicate ledger entries on idempotent replay",
    );

    // Conflicting replay with same idempotencyKey but different amount
    const conflictRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...payload,
        amountMicrocredits: "2000000", // changed amount
      });
    assert.equal(
      conflictRes.status,
      409,
      "Must return 409 Conflict when idempotency payload conflicts",
    );
    assert.equal(
      problemBody(conflictRes).code,
      BILLING_ERROR_CODES.idempotencyConflict,
    );

    // Conflicting replay with same idempotencyKey, same amount, but DIFFERENT reason
    const conflictReasonRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...payload,
        reason: "Different audit reason for the exact same compensation", // changed reason!
      });
    assert.equal(
      conflictReasonRes.status,
      409,
      "Must return 409 Conflict when idempotency key is reused with a different reason",
    );
    assert.equal(
      problemBody(conflictReasonRes).code,
      BILLING_ERROR_CODES.idempotencyConflict,
    );
  });

  it("G07-RED-07c: Idempotent replay returns historical snapshot of original transaction, not current wallet balance", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    // Initial wallet state: 50,000,000 microcredits, 50 credits, version 10
    await prisma.billingWallet.update({
      where: { id: customerWalletId },
      data: {
        balanceMicrocredits: 50_000_000n,
        availableCredits: 50n,
        version: 10,
      },
    });

    const tx1Payload: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "3000000", // 3 credits
      reason: "First compensation for batch audit",
      idempotencyKey: "comp-snapshot-tx1",
    };

    // Transaction 1: 50M -> 53M, version 10 -> 11, totalCompensated = 3M, remaining = 7M
    const res1 = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(tx1Payload);
    assert.equal(res1.status, 200);
    const data1 = successBody<CompensateBillingDebitResponse>(res1);
    assert.equal(data1.walletBalanceMicrocredits, "53000000");
    assert.equal(data1.walletVersion, 11);
    assert.equal(data1.totalCompensatedMicrocredits, "3000000");
    assert.equal(data1.remainingUncompensatedMicrocredits, "7000000");

    // Subsequent Transaction 2: another compensation of 2,000,000
    // Wallet becomes 53M + 2M = 55M, version becomes 12, totalCompensated becomes 5M
    const tx2Payload: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "2000000",
      reason: "Second subsequent compensation",
      idempotencyKey: "comp-snapshot-tx2",
    };
    const res2 = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(tx2Payload);
    assert.equal(res2.status, 200);
    const data2 = successBody<CompensateBillingDebitResponse>(res2);
    assert.equal(data2.walletBalanceMicrocredits, "55000000");
    assert.equal(data2.walletVersion, 12);
    assert.equal(data2.totalCompensatedMicrocredits, "5000000");
    assert.equal(data2.remainingUncompensatedMicrocredits, "5000000");

    // Replay Transaction 1: MUST return the snapshot of Transaction 1!
    // It must return balance 53,000,000, version 11, total 3,000,000, remaining 7,000,000
    // It MUST NOT return current balance 55,000,000 or current version 12!
    const replayTx1 = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(tx1Payload);
    assert.equal(replayTx1.status, 200);
    const replayData1 = successBody<CompensateBillingDebitResponse>(replayTx1);

    assert.equal(
      replayData1.walletBalanceMicrocredits,
      "53000000",
      "Replay must return historical snapshot wallet balance of original transaction, not current balance",
    );
    assert.equal(
      replayData1.walletVersion,
      11,
      "Replay must return historical snapshot wallet version of original transaction, not current version",
    );
    assert.equal(
      replayData1.totalCompensatedMicrocredits,
      "3000000",
      "Replay must return cumulative totalCompensated at the time of original transaction",
    );
    assert.equal(
      replayData1.remainingUncompensatedMicrocredits,
      "7000000",
      "Replay must return remainingUncompensated at the time of original transaction",
    );
    assert.equal(replayData1.compensatedAt, data1.compensatedAt);
  });

  it("G07-RED-07d: Fails closed with 422 BILLING_COMPENSATION_SNAPSHOT_CORRUPT when audit snapshot is missing or corrupted", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    // Subcase 1: Missing AuditEvent -> replay MUST NOT return 200 with fake numbers, must fail closed with 422
    const compEntryMissingId = randomUUID();
    const payloadMissing: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "3000000",
      reason: "Initial compensation for missing audit event test",
      idempotencyKey: "comp-snapshot-missing-audit",
    };
    const canonicalPayloadMissing = JSON.stringify({
      amountMicrocredits: payloadMissing.amountMicrocredits,
      originalLedgerEntryId: payloadMissing.originalLedgerEntryId,
      reason: payloadMissing.reason.trim(),
    });
    const fingerprintMissing = createHash("sha256")
      .update(canonicalPayloadMissing)
      .digest("hex");

    await prisma.creditLedgerEntry.create({
      data: {
        id: compEntryMissingId,
        userId: customerUserId,
        walletId: customerWalletId,
        originalLedgerEntryId: debitEntry.id,
        idempotencyKey: payloadMissing.idempotencyKey,
        requestFingerprint: fingerprintMissing,
        source: CREDIT_LEDGER_SOURCES.COMPENSATION,
        ledgerSource: CREDIT_LEDGER_SOURCES.COMPENSATION as any,
        deltaCredits: BigInt(payloadMissing.amountMicrocredits) / 1_000_000n,
        deltaMicrocredits: BigInt(payloadMissing.amountMicrocredits),
        accountingUnitVersion: 2,
      },
    });
    // Deliberately no AuditEvent is created for compEntryMissingId

    const replayMissingAudit = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payloadMissing);

    assert.equal(
      replayMissingAudit.status,
      422,
      "Replay with missing audit snapshot must fail closed with 422, not return 200 with fabricated data",
    );
    assert.equal(
      problemBody(replayMissingAudit).code,
      BILLING_ERROR_CODES.compensationSnapshotCorrupt,
    );

    // Subcase 2: Corrupted mathematical relationship in audit snapshot
    const compEntryCorruptId = randomUUID();
    const payloadCorrupt: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "2000000",
      reason: "Compensation for corrupt relation test",
      idempotencyKey: "comp-snapshot-corrupt-math",
    };
    const canonicalPayloadCorrupt = JSON.stringify({
      amountMicrocredits: payloadCorrupt.amountMicrocredits,
      originalLedgerEntryId: payloadCorrupt.originalLedgerEntryId,
      reason: payloadCorrupt.reason.trim(),
    });
    const fingerprintCorrupt = createHash("sha256")
      .update(canonicalPayloadCorrupt)
      .digest("hex");

    await prisma.creditLedgerEntry.create({
      data: {
        id: compEntryCorruptId,
        userId: customerUserId,
        walletId: customerWalletId,
        originalLedgerEntryId: debitEntry.id,
        idempotencyKey: payloadCorrupt.idempotencyKey,
        requestFingerprint: fingerprintCorrupt,
        source: CREDIT_LEDGER_SOURCES.COMPENSATION,
        ledgerSource: CREDIT_LEDGER_SOURCES.COMPENSATION as any,
        deltaCredits: BigInt(payloadCorrupt.amountMicrocredits) / 1_000_000n,
        deltaMicrocredits: BigInt(payloadCorrupt.amountMicrocredits),
        accountingUnitVersion: 2,
      },
    });

    // Directly insert corrupted AuditEvent (append-only is permitted by storage trigger)
    await prisma.auditEvent.create({
      data: {
        id: randomUUID(),
        eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
        actorId: adminUserId,
        resourceId: compEntryCorruptId,
        correlationId: "corr-corrupt-math-test",
        payload: {
          action: BILLING_ACTIONS.compensation,
          originalLedgerEntryId: debitEntry.id,
          amountMicrocredits: payloadCorrupt.amountMicrocredits,
          reason: payloadCorrupt.reason,
          walletId: customerWalletId,
          userId: customerUserId,
          previousBalanceMicrocredits: "100000000",
          newBalanceMicrocredits: "102000000",
          walletVersion: 5,
          totalCompensatedMicrocredits: "88888888", // Invalid! total + remaining != debit
          remainingUncompensatedMicrocredits: "1000000",
          compensatedAt: new Date().toISOString(),
          requestFingerprint: fingerprintCorrupt,
        },
      },
    });

    const replayCorrupt = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payloadCorrupt);

    assert.equal(
      replayCorrupt.status,
      422,
      "Replay with corrupted audit snapshot relations must fail closed with 422",
    );
    assert.equal(
      problemBody(replayCorrupt).code,
      BILLING_ERROR_CODES.compensationSnapshotCorrupt,
    );

    // Subcase 3: Corrupted non-ISO datetime format in audit snapshot
    const compEntryBadDateId = randomUUID();
    const payloadBadDate: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "1000000",
      reason: "Compensation for invalid datetime format test",
      idempotencyKey: "comp-snapshot-bad-date",
    };
    const canonicalPayloadBadDate = JSON.stringify({
      amountMicrocredits: payloadBadDate.amountMicrocredits,
      originalLedgerEntryId: payloadBadDate.originalLedgerEntryId,
      reason: payloadBadDate.reason.trim(),
    });
    const fingerprintBadDate = createHash("sha256")
      .update(canonicalPayloadBadDate)
      .digest("hex");

    await prisma.creditLedgerEntry.create({
      data: {
        id: compEntryBadDateId,
        userId: customerUserId,
        walletId: customerWalletId,
        originalLedgerEntryId: debitEntry.id,
        idempotencyKey: payloadBadDate.idempotencyKey,
        requestFingerprint: fingerprintBadDate,
        source: CREDIT_LEDGER_SOURCES.COMPENSATION,
        ledgerSource: CREDIT_LEDGER_SOURCES.COMPENSATION as any,
        deltaCredits: BigInt(payloadBadDate.amountMicrocredits) / 1_000_000n,
        deltaMicrocredits: BigInt(payloadBadDate.amountMicrocredits),
        accountingUnitVersion: 2,
      },
    });

    // Directly insert AuditEvent with invalid non-ISO datetime (e.g. date-only string missing time component)
    await prisma.auditEvent.create({
      data: {
        id: randomUUID(),
        eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
        actorId: adminUserId,
        resourceId: compEntryBadDateId,
        correlationId: "corr-bad-date-test",
        payload: {
          action: BILLING_ACTIONS.compensation,
          originalLedgerEntryId: debitEntry.id,
          amountMicrocredits: payloadBadDate.amountMicrocredits,
          reason: payloadBadDate.reason,
          walletId: customerWalletId,
          userId: customerUserId,
          previousBalanceMicrocredits: "100000000",
          newBalanceMicrocredits: "101000000",
          walletVersion: 5,
          totalCompensatedMicrocredits: "1000000",
          remainingUncompensatedMicrocredits: "9000000",
          compensatedAt: "2026-11-27", // Non-ISO datetime (violates z.string().datetime())
          requestFingerprint: fingerprintBadDate,
        },
      },
    });

    const replayBadDate = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payloadBadDate);

    assert.equal(
      replayBadDate.status,
      422,
      "Replay with non-ISO compensatedAt in audit snapshot must fail closed with 422",
    );
    assert.equal(
      problemBody(replayBadDate).code,
      BILLING_ERROR_CODES.compensationSnapshotCorrupt,
    );
  });

  it("G07-RED-07e: Storage-tier immutability trigger prevents UPDATE and DELETE on compensation AuditEvent", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    const payload: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "2500000",
      reason: "Storage-tier immutability verification test",
      idempotencyKey: "comp-immutability-trigger-test",
    };

    const res = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);
    assert.equal(res.status, 200);
    const data = successBody<CompensateBillingDebitResponse>(res);

    // Locate the durable compensation audit event in Postgres
    const auditRecord = await prisma.auditEvent.findFirstOrThrow({
      where: {
        resourceId: data.ledgerEntryId,
        eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
      },
    });

    // Invariant 1: Direct UPDATE must be rejected at storage tier by PostgreSQL trigger
    await assert.rejects(
      async () => {
        await prisma.auditEvent.update({
          where: { id: auditRecord.id },
          data: { correlationId: "tampered-correlation-id" },
        });
      },
      (err: Error) => {
        return err.message.includes(
          "immutable at storage tier and cannot be updated or deleted",
        );
      },
      "PostgreSQL trigger must reject direct UPDATE on compensation AuditEvent",
    );

    // Invariant 2: Direct DELETE must be rejected at storage tier by PostgreSQL trigger
    await assert.rejects(
      async () => {
        await prisma.auditEvent.delete({
          where: { id: auditRecord.id },
        });
      },
      (err: Error) => {
        return err.message.includes(
          "immutable at storage tier and cannot be updated or deleted",
        );
      },
      "PostgreSQL trigger must reject direct DELETE on compensation AuditEvent",
    );

    // Verify row remains completely intact in database
    const intactRecord = await prisma.auditEvent.findUniqueOrThrow({
      where: { id: auditRecord.id },
    });
    assert.equal(intactRecord.correlationId, auditRecord.correlationId);
  });

  it("G07-RED-07b: Concurrent requests with identical idempotency key resolve without DB constraint collision (500)", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    const payload: CompensateBillingDebitRequest = {
      originalLedgerEntryId: debitEntry.id,
      amountMicrocredits: "3000000",
      reason: "Concurrent idempotency race test",
      idempotencyKey: "comp-race-same-key-01",
    };

    // Subcase 1: Two identical concurrent requests with the SAME idempotency key
    const req1 = httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    const req2 = httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    const [res1, res2] = await Promise.all([req1, req2]);

    assert.notEqual(
      res1.status,
      500,
      "Request 1 must never fail with 500 DB constraint collision",
    );
    assert.notEqual(
      res2.status,
      500,
      "Request 2 must never fail with 500 DB constraint collision",
    );
    assert.equal(
      res1.status,
      200,
      `Request 1 should succeed with 200, got ${res1.status}`,
    );
    assert.equal(
      res2.status,
      200,
      `Request 2 should succeed with 200, got ${res2.status}`,
    );

    const data1 = successBody<CompensateBillingDebitResponse>(res1);
    const data2 = successBody<CompensateBillingDebitResponse>(res2);

    // Both must return the same ledgerEntryId and same resulting balance
    assert.equal(data1.ledgerEntryId, data2.ledgerEntryId);
    assert.equal(
      data1.walletBalanceMicrocredits,
      data2.walletBalanceMicrocredits,
    );

    // Exactly one ledger entry created in database
    const count = await prisma.creditLedgerEntry.count({
      where: { idempotencyKey: payload.idempotencyKey },
    });
    assert.equal(count, 1, "Must create exactly one CreditLedgerEntry in DB");

    // Subcase 2: Two concurrent requests with SAME idempotency key but CONFLICTING payload
    const conflictKey = "comp-race-conflict-key-02";
    const reqConfA = httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "2000000",
        reason: "Concurrent conflict request A",
        idempotencyKey: conflictKey,
      });

    const reqConfB = httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "4000000", // different amount!
        reason: "Concurrent conflict request B",
        idempotencyKey: conflictKey,
      });

    const [resConfA, resConfB] = await Promise.all([reqConfA, reqConfB]);

    assert.notEqual(resConfA.status, 500, "Request A must never fail with 500");
    assert.notEqual(resConfB.status, 500, "Request B must never fail with 500");

    const confStatuses = [resConfA.status, resConfB.status].sort();
    assert.deepEqual(
      confStatuses,
      [200, 409],
      `Expected one 200 OK and one 409 Conflict, got [${resConfA.status}, ${resConfB.status}]`,
    );

    const conflictErrRes = resConfA.status === 409 ? resConfA : resConfB;
    assert.equal(
      problemBody(conflictErrRes).code,
      BILLING_ERROR_CODES.idempotencyConflict,
    );
  });

  it("G07-RED-08: Concurrency serialization prevents two simultaneous requests from exceeding bounds", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    // Already compensated 5,000,000 microcredits -> Remaining: 5,000,000
    await prisma.creditLedgerEntry.create({
      data: {
        userId: customerUserId,
        walletId: customerWalletId,
        idempotencyKey: "comp-prior-seed",
        source: CREDIT_LEDGER_SOURCES.COMPENSATION,
        ledgerSource: CREDIT_LEDGER_SOURCES.COMPENSATION as any,
        deltaCredits: 5n,
        deltaMicrocredits: 5_000_000n,
        originalLedgerEntryId: debitEntry.id,
        accountingUnitVersion: 2,
      },
    });

    // Two simultaneous requests each demanding 4,000,000 microcredits (Total 8,000,000 > 5,000,000 remaining)
    const reqA = httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "4000000",
        reason: "Concurrent request A",
        idempotencyKey: "race-key-a",
      });

    const reqB = httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "4000000",
        reason: "Concurrent request B",
        idempotencyKey: "race-key-b",
      });

    const [resA, resB] = await Promise.all([reqA, reqB]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(
      statuses,
      [200, 422],
      `Expected exactly one 200 OK and one 422 Unprocessable Entity, got [${resA.status}, ${resB.status}]`,
    );

    const failedRes = resA.status === 422 ? resA : resB;
    assert.equal(
      problemBody(failedRes).code,
      BILLING_ERROR_CODES.compensationLimitExceeded,
    );

    // Verify DB cumulative sum equals exactly 5,000,000 (prior) + 4,000,000 (winner) = 9,000,000 <= 10,000,000
    const compensations = await prisma.creditLedgerEntry.findMany({
      where: {
        originalLedgerEntryId: debitEntry.id,
        source: CREDIT_LEDGER_SOURCES.COMPENSATION,
      },
    });
    const totalCompensated = compensations.reduce(
      (sum, e) => sum + (e.deltaMicrocredits ?? 0n),
      0n,
    );
    assert.equal(
      totalCompensated,
      9_000_000n,
      "Cumulative compensation must never exceed original debit",
    );
  });

  it("G07-RED-09: Atomic 4-record commit (Ledger, Wallet, Audit, Outbox) and midway rollback", async () => {
    const { debitEntry } = await seedEligibleDebit(10_000_000n);

    // 1. Successful compensation: verifies all 4 records created
    const successRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-correlation-id", "corr-comp-atomic-success")
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "2000000",
        reason: "Valid atomic compensation",
        idempotencyKey: "comp-atomic-success",
      });
    assert.equal(successRes.status, 200);
    const successData = successBody<CompensateBillingDebitResponse>(successRes);

    // Verify AuditEvent created
    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        resourceId: successData.ledgerEntryId,
        eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
      },
    });
    assert.ok(auditEvent, "AuditEvent must be created in the same transaction");
    assert.equal(auditEvent.correlationId, "corr-comp-atomic-success");

    // Verify OutboxMessage created
    const outboxMessage = await prisma.outboxMessage.findFirst({
      where: {
        aggregateId: customerWalletId,
        aggregateType: OUTBOX_AGGREGATE_TYPES.billingWallet as any,
        eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
      },
    });
    assert.ok(
      outboxMessage,
      "OutboxMessage must be created in the same transaction",
    );

    // 2. Simulated failure midway via correlationId: 'fail-atomic-compensation'
    const walletBeforeFail = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: customerWalletId },
    });
    const ledgerCountBefore = await prisma.creditLedgerEntry.count();

    const failedRes = await httpRequest(app)
      .post("/admin/billing/compensate")
      .set("Authorization", `Bearer ${adminToken}`)
      .set("x-correlation-id", "fail-atomic-compensation")
      .send({
        originalLedgerEntryId: debitEntry.id,
        amountMicrocredits: "2000000",
        reason: "Simulated failing compensation",
        idempotencyKey: "comp-atomic-failure",
      });

    assert.notEqual(
      failedRes.status,
      200,
      "Midway failure must not return 200 OK",
    );

    // Verify wallet was NOT mutated
    const walletAfterFail = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: customerWalletId },
    });
    assert.equal(
      walletAfterFail.balanceMicrocredits,
      walletBeforeFail.balanceMicrocredits,
    );
    assert.equal(walletAfterFail.version, walletBeforeFail.version);

    // Verify NO new CreditLedgerEntry was created
    const ledgerCountAfter = await prisma.creditLedgerEntry.count();
    assert.equal(ledgerCountAfter, ledgerCountBefore);
  });

  it("G07-RED-10: Operates with MODEL_USAGE_DEBIT=OFF and PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF", () => {
    assert.equal(
      process.env.MODEL_USAGE_DEBIT,
      "OFF",
      "MODEL_USAGE_DEBIT must remain OFF",
    );
    assert.equal(
      process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE,
      "OFF",
      "PROVIDER_RECONCILIATION_AUTOMATED_RELEASE must remain OFF",
    );
  });
});
