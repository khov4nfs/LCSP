/**
 * WP8 BillingReconciliationCase Administration & Audited Resolution Acceptance Tests (Postgres E2E)
 *
 * Rationale ("Why"): ADR-028 Line 155 & Line 173 mandate that `DISPATCH_UNKNOWN` and `OUTCOME_UNKNOWN`
 * model invocations retain bounded financial exposure and route to a versioned `BillingReconciliationCase`.
 * Admin manual decision requires explicit action permission, verified provider log evidence,
 * immutable audit trail, and strict distinction from the automated release gate.
 *
 * Business Invariants & Constraints:
 * 1. Authority Separation: Admin manual decision is an audited administrative action requiring explicit
 *    `billing:reconciliation:decision` action permission. It must operate when `PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF`.
 * 2. Worker Non-Self-Release: Once an invocation is `IN_FLIGHT`, workers cannot self-certify "no-usage"
 *    to unilaterally clear financial exposure. Exposure remains held and routes to `BillingReconciliationCase`.
 * 3. Evidence Rigor: Closing as `CONFIRMED_NO_USAGE` requires cryptographically verified provider log artifacts
 *    whose temporal coverage window completely encloses the potential dispatch window, containing zero dispatched records.
 * 4. Slot Retention vs Release: `CONFIRMED_NO_USAGE` resets maximum exposure to 0 and releases concurrency slot;
 *    `FLAG_INTEGRITY_REVIEW` / `MAINTAIN_EXPOSURE` retains full exposure and keeps the wallet slot blocked.
 * 5. Concurrency Serialization: Competing admin decisions on the same case serialize under row lock (`FOR UPDATE`),
 *    preventing state desynchronization or unhandled 500 collisions.
 * 6. Idempotency: Replaying with identical idempotencyKey and payload returns 200 with historical resolution snapshot.
 *    Replaying with conflicting decision or rationale returns 409 (`BILLING_IDEMPOTENCY_CONFLICT`).
 * 7. Terminal Precedence: An unaudited late receipt cannot overwrite an admin-reviewed `CONFIRMED_NO_USAGE` outcome;
 *    it appends conflicting evidence to `INTEGRITY_REVIEW` without charging the wallet.
 * 8. Operational Safety: Operates with `MODEL_USAGE_DEBIT=OFF` and `PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF`.
 */

import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    AUTH_ERROR_CODES,
    AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import {
    ADMISSION_STATES,
    BILLING_AUDIT_EVENT_TYPES,
    BILLING_ERROR_CODES,
    BILLING_ROLLOUT_MODES,
    MODEL_USAGE_DEBIT_MODES,
    PROVIDER_COMPLETION_STATES,
    RECONCILIATION_CASE_STATES,
    RECONCILIATION_DECISION_ACTIONS,
    computeWorkerPreSocketRejectionHmac,
    type BillingReconciliationCaseDetailResponse,
    type BillingReconciliationCaseItem,
    type ReconciliationCaseDecisionRequest,
    type ReconciliationCaseDecisionResponse
} from "@lcsp/contracts/billing";
import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import { ReconciliationArtifactService } from "../src/modules/billing/application/shared/reconciliation-artifact.service.js";
import { createAuthSessionRecord } from "./support/auth-record-test-helpers.js";
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

describe("WP8 BillingReconciliationCase Administration & Audited Resolution (Postgres E2E)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let artifactService: ReconciliationArtifactService;
  let adminToken: string;
  let adminUserId: string;
  let customerToken: string;
  let customerUserId: string;
  let customerWalletId: string;
  let anthropicKeypair: { keyId: string; privateKeyPem: string };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.WORKER_API_KEY = WORKER_TEST_API_KEY;
    // Operational safety invariants: Debit feature gate and automated release gate MUST remain OFF
    process.env.MODEL_USAGE_DEBIT = "OFF";
    process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE = "OFF";

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

    // Register test Ed25519 keypair for Anthropic
    const keyId = "key-anthropic-recon-test-2026";
    const keypair = artifactService.generateAndRegisterProviderKeyPair("anthropic", keyId, true);
    anthropicKeypair = { keyId, privateKeyPem: keypair.privateKeyPem };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "OutboxMessage",
        "ModelUsageReceipt",
        "ProviderLogArtifact",
        "BillingReconciliationDecisionReceipt",
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

    // Sign in as regular customer
    const customerSignIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
    });
    customerToken = successBody<SignInSuccess>(customerSignIn).session_token ?? "";

    // Seed customer prepaid wallet with 100 credits (100,000,000 microcredits)
    const wallet = await prisma.billingWallet.create({
      data: {
        userId: customerUserId,
        balanceMicrocredits: 100_000_000n,
        availableCredits: 100n,
        accountingUnitVersion: 2,
        version: 1,
      },
    });
    customerWalletId = wallet.id;
  });

  /**
   * Helper: Seeds an admitted invocation in DISPATCH_UNKNOWN state with bounded exposure and an open BillingReconciliationCase.
   */
  async function seedReconciliationCase(options?: {
    exposureMicrocredits?: bigint;
    state?: string;
    consumed?: boolean;
    provider?: string;
    platformSponsored?: boolean;
  }): Promise<{
    admission: any;
    reconCase: any;
    correlationId: string;
    admittedAt: Date;
    consumedAt: Date | null;
    capabilityToken: string;
  }> {
    const invocationId = crypto.randomUUID();
    const admissionId = crypto.randomUUID();
    const caseId = `case-${invocationId}`;
    const correlationId = `corr-${invocationId}`;
    const exposure = options?.exposureMicrocredits ?? 5_000_000n;
    const provider = options?.provider ?? "anthropic";
    const caseState = options?.state ?? RECONCILIATION_CASE_STATES.OPEN;

    const now = new Date();
    const admittedAt = new Date(now.getTime() - 600_000); // 10 mins ago
    const expiresAt = new Date(admittedAt.getTime() + 300_000); // 5 mins after admitted
    const consumedAt = options?.consumed ? new Date(admittedAt.getTime() + 10_000) : null;
    const capabilityToken = `tok-test-capability-token-32-chars-long-${invocationId}`.slice(0, 64);
    const capabilityDigest = crypto.createHash("sha256").update(capabilityToken).digest("hex");

    const admission = await prisma.billableInvocationAdmission.create({
      data: {
        id: admissionId,
        invocationId,
        correlationId,
        admissionRequestId: `req-${invocationId}`,
        requestFingerprint: `fp-${invocationId}`,
        logicalOperationId: `op-${invocationId}`,
        attemptOrdinal: 1,
        fundingPrincipal: options?.platformSponsored ? "PLATFORM_SPONSORED" : "CUSTOMER_WALLET",
        userId: options?.platformSponsored ? null : customerUserId,
        walletId: options?.platformSponsored ? null : customerWalletId,
        runId: `run-${invocationId}`,
        agentRole: "code-reviewer",
        operationType: "model_call",
        requestedModel: "claude-3-5-sonnet",
        resolvedProvider: provider,
        resolvedModel: "claude-3-5-sonnet",
        runtimePolicyVersion: "v1",
        rolloutMode: BILLING_ROLLOUT_MODES.TELEMETRY_ONLY,
        debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: exposure,
        initialExposureMicrocredits: exposure,
        capabilityDigest,
        state: ADMISSION_STATES.DISPATCH_UNKNOWN,
        version: 1,
        admittedAt,
        expiresAt,
        consumedAt,
      },
    });

    const reconCase = await prisma.billingReconciliationCase.create({
      data: {
        caseId,
        invocationId,
        admissionId,
        state: caseState as any,
        provider,
        providerCorrelationId: correlationId,
        version: 1,
      },
    });

    return { admission, reconCase, correlationId, admittedAt, consumedAt, capabilityToken };
  }

  /**
   * Helper: Creates a verified, cryptographically signed ProviderLogArtifact in PostgreSQL.
   */
  async function seedVerifiedProviderLog(params: {
    artifactId: string;
    coverageStart: Date;
    coverageEnd: Date;
    entries?: any[];
    finalizedWatermark?: Date;
    provider?: string;
  }): Promise<any> {
    const provider = params.provider ?? "anthropic";
    const entries = params.entries ?? [];
    const rawContent = JSON.stringify(entries);
    const sha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
    const watermark = params.finalizedWatermark ?? params.coverageEnd;

    const statement = artifactService.computeCanonicalStatement({
      provider,
      artifactId: params.artifactId,
      sha256,
      coverageStart: params.coverageStart,
      coverageEnd: params.coverageEnd,
      finalizedWatermark: watermark,
    });

    const signature = crypto.sign(null, Buffer.from(statement, "utf8"), anthropicKeypair.privateKeyPem).toString("base64");

    return prisma.providerLogArtifact.create({
      data: {
        artifactId: params.artifactId,
        provider,
        source: "PROVIDER_EXPORT_VERIFIED",
        signingKeyId: anthropicKeypair.keyId,
        providerSignature: signature,
        sha256,
        coverageStart: params.coverageStart,
        coverageEnd: params.coverageEnd,
        finalizedWatermark: watermark,
        rawContent,
        verified: true,
        ingestedBy: "system-test",
      },
    });
  }

  // =========================================================================
  // RECON-RED-01: RBAC Enforcement
  // =========================================================================
  it("RECON-RED-01: RBAC enforcement rejects customer, worker, unauthenticated callers, and admins without reconciliation permission", async () => {
    const { reconCase } = await seedReconciliationCase();

    const decisionPayload: ReconciliationCaseDecisionRequest = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: "recon-rbac-test-01",
      auditRationale: "Provider logs prove request never reached provider socket",
      providerLogArtifactId: "art-test-01",
    };

    // 1. Unauthenticated -> 401
    const unauthList = await httpRequest(app).get("/admin/billing/reconciliation/cases");
    assert.equal(unauthList.status, 401, "Unauthenticated list must return 401");

    const unauthDetail = await httpRequest(app).get(`/admin/billing/reconciliation/cases/${reconCase.caseId}`);
    assert.equal(unauthDetail.status, 401, "Unauthenticated detail must return 401");

    const unauthDecide = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .send(decisionPayload);
    assert.equal(unauthDecide.status, 401, "Unauthenticated decision must return 401");

    // 2. Regular customer -> 403 Forbidden
    const customerList = await httpRequest(app)
      .get("/admin/billing/reconciliation/cases")
      .set("Authorization", `Bearer ${customerToken}`);
    assert.equal(customerList.status, 403, "Customer cannot list reconciliation cases");

    const customerDetail = await httpRequest(app)
      .get(`/admin/billing/reconciliation/cases/${reconCase.caseId}`)
      .set("Authorization", `Bearer ${customerToken}`);
    assert.equal(customerDetail.status, 403, "Customer cannot view reconciliation case detail");

    const customerDecide = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(decisionPayload);
    assert.equal(customerDecide.status, 403, "Customer cannot make reconciliation decisions");

    // 3. Worker API key -> 401/403 Forbidden (worker key does not confer Admin authority)
    const workerList = await httpRequest(app)
      .get("/admin/billing/reconciliation/cases")
      .set("x-worker-api-key", WORKER_TEST_API_KEY);
    assert.ok(
      workerList.status === 401 || workerList.status === 403,
      `Worker key cannot list reconciliation cases, got ${workerList.status}`,
    );

    const workerDecide = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send(decisionPayload);
    assert.ok(
      workerDecide.status === 401 || workerDecide.status === 403,
      `Worker key cannot make reconciliation decisions, got ${workerDecide.status}`,
    );

    const workerWithCustomerList = await httpRequest(app)
      .get("/admin/billing/reconciliation/cases")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("x-worker-api-key", WORKER_TEST_API_KEY);
    assert.equal(
      workerWithCustomerList.status,
      403,
      "Worker key with customer session must be rejected with 403",
    );

    // 4. Admin lacking explicit billing:reconciliation:decision action permission -> 403 Forbidden
    const noActionToken = "admin-no-action-token";
    await createAuthSessionRecord(prisma, {
      id: "session-admin-no-action",
      userId: adminUserId,
      token: noActionToken,
      expiresAt: new Date(Date.now() + 3600_000),
      metadata: {
        permissions: ["billing:pricing_draft:create"], // Missing billing:reconciliation:decision
      },
    });
    const noActionRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${noActionToken}`)
      .send(decisionPayload);
    assert.equal(
      noActionRes.status,
      403,
      "Admin without billing:reconciliation:decision action must be rejected with 403",
    );
    assert.equal(problemBody(noActionRes).code, AUTH_ERROR_CODES.rbacDenied);
  });

  // =========================================================================
  // RECON-RED-02: Worker Non-Self-Release Invariant
  // =========================================================================
  it("RECON-RED-02: Worker cannot self-certify no-usage after IN_FLIGHT: exposure remains held and routes to reconciliation", async () => {
    // Seed an admission in IN_FLIGHT state
    const invocationId = crypto.randomUUID();
    const admissionId = crypto.randomUUID();
    const capabilityToken = `tok-test-capability-token-32-chars-long-${invocationId}`.slice(0, 64);
    const capabilityDigest = crypto.createHash("sha256").update(capabilityToken).digest("hex");

    const admission = await prisma.billableInvocationAdmission.create({
      data: {
        id: admissionId,
        invocationId,
        correlationId: `corr-flight-${invocationId}`,
        admissionRequestId: `req-flight-${invocationId}`,
        requestFingerprint: `fp-flight-${invocationId}`,
        logicalOperationId: `op-flight-${invocationId}`,
        attemptOrdinal: 1,
        fundingPrincipal: "CUSTOMER_WALLET",
        userId: customerUserId,
        walletId: customerWalletId,
        runId: `run-flight-${invocationId}`,
        agentRole: "code-reviewer",
        operationType: "model_call",
        requestedModel: "claude-3-5-sonnet",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-3-5-sonnet",
        runtimePolicyVersion: "v1",
        rolloutMode: BILLING_ROLLOUT_MODES.TELEMETRY_ONLY,
        debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 4_500_000n,
        initialExposureMicrocredits: 4_500_000n,
        capabilityDigest,
        state: ADMISSION_STATES.IN_FLIGHT,
        version: 1,
        admittedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
      },
    });

    // Worker attempts to claim LOCAL_PRE_SOCKET_REJECTION with mathematically valid HMAC
    const failureCategory = "LOCAL_PRE_SOCKET_REJECTION";
    const clientTimestamp = new Date().toISOString();
    const validHmac = computeWorkerPreSocketRejectionHmac(
      capabilityToken,
      admission.id,
      admission.invocationId,
      failureCategory,
      clientTimestamp,
    );

    const settleAttempt = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.id,
        invocationId: admission.invocationId,
        capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.FAILED,
        workerClaimedPreSocketError: true,
        workerClaimFailureCategory: failureCategory,
        workerClaimTimestamp: clientTimestamp,
        workerClaimSignature: validHmac,
      });

    // Invariant (ADR-028 Line 94): Server MUST NOT trust worker HMAC to transition to CONFIRMED_NO_USAGE
    assert.ok(settleAttempt.status === 200 || settleAttempt.status === 202, `Expected 200/202, got ${settleAttempt.status}`);
    const body = successBody<any>(settleAttempt);
    assert.notEqual(
      body.state,
      ADMISSION_STATES.CONFIRMED_NO_USAGE,
      "Worker settlement cannot unilaterally transition IN_FLIGHT admission to CONFIRMED_NO_USAGE",
    );
    assert.equal(
      body.state,
      ADMISSION_STATES.DISPATCH_UNKNOWN,
      "Unsettled IN_FLIGHT failure must route to DISPATCH_UNKNOWN",
    );
    assert.equal(body.slotReleased, false, "Slot must not be released on worker claim");

    // Verify slot remains strictly held in DB
    const dbAdm = await prisma.billableInvocationAdmission.findUniqueOrThrow({
      where: { id: admission.id },
    });
    assert.equal(
      dbAdm.maximumExposureMicrocredits,
      4_500_000n,
      "Maximum exposure must remain held when worker reports failure after IN_FLIGHT",
    );
    assert.equal(dbAdm.state, ADMISSION_STATES.DISPATCH_UNKNOWN);

    // Verify BillingReconciliationCase was opened in OPEN state
    const reconCase = await prisma.billingReconciliationCase.findUnique({
      where: { invocationId: admission.invocationId },
    });
    assert.ok(reconCase, "Must create BillingReconciliationCase for unresolved IN_FLIGHT invocation");
    assert.equal(reconCase.state, RECONCILIATION_CASE_STATES.OPEN);
  });

  // =========================================================================
  // RECON-RED-03: Admin Query & Evidence Inspection
  // =========================================================================
  it("RECON-RED-03: Admin can list BillingReconciliationCase records with state filter and inspect single case with linked evidence", async () => {
    const { reconCase, admission } = await seedReconciliationCase({
      exposureMicrocredits: 6_000_000n,
      state: RECONCILIATION_CASE_STATES.OPEN,
    });

    // Seed a verified ProviderLogArtifact covering this invocation
    const now = Date.now();
    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-query-test-${admission.invocationId}`,
      coverageStart: new Date(now - 700_000),
      coverageEnd: new Date(now),
      entries: [
        {
          requestId: "req-other-001",
          timestamp: new Date(now - 500_000).toISOString(),
          correlationId: "foreign-correlation-id",
        },
      ],
    });

    // Update reconCase with artifact linkage
    await prisma.billingReconciliationCase.update({
      where: { caseId: reconCase.caseId },
      data: {
        providerLogArtifactId: artifact.artifactId,
        providerLogArchiveSha256: artifact.sha256,
        coverageStart: artifact.coverageStart,
        coverageEnd: artifact.coverageEnd,
      },
    });

    // 1. List cases filtered by state=OPEN
    const listRes = await httpRequest(app)
      .get("/admin/billing/reconciliation/cases?state=OPEN&page=1&pageSize=10")
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(listRes.status, 200, `List must return 200, got ${listRes.status}`);

    const listData = successBody<{ items: BillingReconciliationCaseItem[]; total: number }>(listRes);
    assert.ok(listData.items.length >= 1, "Must list at least 1 open reconciliation case");
    const foundCase = listData.items.find((item) => item.caseId === reconCase.caseId);
    assert.ok(foundCase, "Seeded case must appear in list output");
    assert.equal(foundCase.state, RECONCILIATION_CASE_STATES.OPEN);
    assert.equal(foundCase.admission.maximumExposureMicrocredits, "6000000");
    assert.equal(foundCase.admission.walletId, customerWalletId);

    // 2. Query case detail
    const detailRes = await httpRequest(app)
      .get(`/admin/billing/reconciliation/cases/${reconCase.caseId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(detailRes.status, 200, `Detail must return 200, got ${detailRes.status}`);

    const detailData = successBody<BillingReconciliationCaseDetailResponse>(detailRes);
    assert.equal(detailData.caseId, reconCase.caseId);
    assert.equal(detailData.invocationId, admission.invocationId);
    assert.equal(detailData.admission.maximumExposureMicrocredits, "6000000");
    assert.equal(detailData.provider, "anthropic");
    assert.ok(detailData.evidenceArtifact, "Must include linked provider log artifact evidence");
    assert.equal(detailData.evidenceArtifact.artifactId, artifact.artifactId);
    assert.equal(detailData.evidenceArtifact.verified, true);
  });

  // =========================================================================
  // RECON-RED-04: Separation of Admin Decision from Automated Release Gate
  // =========================================================================
  it("RECON-RED-04a: Admin can retain exposure for a platform-sponsored case without a customer wallet", async () => {
    // Why: Platform sponsorship has no BillingWallet, yet its unknown outcomes still need an audited decision.
    // How: Exercise the real Admin endpoint against a platform admission and verify the case transition.
    // Invariant: A missing customer wallet must never be mistaken for a missing platform case.
    const { reconCase, admission } = await seedReconciliationCase({ platformSponsored: true });
    const decideRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.maintainExposure,
        idempotencyKey: `idem-platform-${admission.invocationId}`,
        auditRationale: "Platform provider outcome remains unknown; preserve risk for audit",
      });

    assert.equal(decideRes.status, 200);
    assert.equal(successBody<ReconciliationCaseDecisionResponse>(decideRes).slotReleased, false);
    const savedCase = await prisma.billingReconciliationCase.findUniqueOrThrow({
      where: { caseId: reconCase.caseId },
    });
    assert.equal(savedCase.state, RECONCILIATION_CASE_STATES.EVIDENCE_PENDING);
  });

  it("RECON-RED-04: Admin manual decision succeeds when PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF, releasing slot and recording audit event", async () => {
    // Assert invariant: automated release gate is OFF
    assert.equal(process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE, "OFF");

    const { reconCase, admission, correlationId, admittedAt } = await seedReconciliationCase({
      exposureMicrocredits: 3_000_000n,
      state: RECONCILIATION_CASE_STATES.OPEN,
    });

    // Ingest verified provider log artifact covering the potential dispatch window with ZERO matching requests
    const now = Date.now();
    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(now - 60_000);

    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-admin-decision-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [
        {
          requestId: "req-clean-01",
          timestamp: new Date(now - 300_000).toISOString(),
          correlationId: "some-unrelated-correlation-id",
        },
      ],
    });

    const payload: ReconciliationCaseDecisionRequest = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: `recon-decide-manual-${admission.invocationId}`,
      auditRationale: "Admin independently verified provider audit log: zero dispatch occurred",
      providerLogArtifactId: artifact.artifactId,
    };

    // Execute Admin decision
    const decideRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    assert.equal(
      decideRes.status,
      200,
      `Admin decision must succeed with 200 even when PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF, got ${decideRes.status}`,
    );
    const data = successBody<ReconciliationCaseDecisionResponse>(decideRes);
    assert.equal(data.decided, true);
    assert.equal(data.decision, RECONCILIATION_DECISION_ACTIONS.confirmNoUsage);
    assert.equal(data.newState, RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE);
    assert.equal(data.slotReleased, true);

    // Verify DB states
    const updatedAdmission = await prisma.billableInvocationAdmission.findUniqueOrThrow({
      where: { id: admission.id },
    });
    assert.equal(updatedAdmission.state, ADMISSION_STATES.CONFIRMED_NO_USAGE);
    assert.equal(updatedAdmission.maximumExposureMicrocredits, 0n, "Exposure must be zeroed out");

    const updatedCase = await prisma.billingReconciliationCase.findUniqueOrThrow({
      where: { caseId: reconCase.caseId },
    });
    assert.equal(updatedCase.state, RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE);
    assert.equal(updatedCase.resolvedBy, adminUserId);

    // Verify immutable AuditEvent recorded
    const auditRecord = await prisma.auditEvent.findFirst({
      where: {
        resourceId: reconCase.caseId,
        eventType: BILLING_AUDIT_EVENT_TYPES.reconciliationDecided,
      },
    });
    assert.ok(auditRecord, "Must persist AuditEvent for reconciliation decision");
    assert.equal(auditRecord.actorId, adminUserId);
    const auditPayload = auditRecord.payload as Record<string, unknown>;
    assert.equal(auditPayload.decision, RECONCILIATION_DECISION_ACTIONS.confirmNoUsage);
    assert.equal(auditPayload.slotReleased, true);
  });

  // =========================================================================
  // RECON-RED-05: Missing or Malformed Evidence (Bằng chứng thiếu / sai)
  // =========================================================================
  it("RECON-RED-05a: Decision fails closed with 422 BILLING_INVALID_RECONCILIATION_EVIDENCE when provider log artifact is missing or corrupt", async () => {
    const { reconCase, admission } = await seedReconciliationCase();

    const payload: ReconciliationCaseDecisionRequest = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: `recon-corrupt-art-${admission.invocationId}`,
      auditRationale: "Admin attempt with non-existent artifact",
      providerLogArtifactId: "art-non-existent-99999",
    };

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    assert.equal(res.status, 422, "Missing artifact must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.invalidReconciliationEvidence);
  });

  it("RECON-RED-05b: Decision fails closed with 422 BILLING_INCOMPLETE_RECONCILIATION_WINDOW when coverage window is insufficient", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase();

    // Coverage starts AFTER admittedAt -> incomplete coverage window!
    const coverageStart = new Date(admittedAt.getTime() + 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);

    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-window-gap-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [],
    });

    const payload: ReconciliationCaseDecisionRequest = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: `recon-window-gap-${admission.invocationId}`,
      auditRationale: "Admin attempt with window starting after admittedAt",
      providerLogArtifactId: artifact.artifactId,
    };

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    assert.equal(res.status, 422, "Insufficient coverage window must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.incompleteReconciliationWindow);
  });

  it("RECON-RED-05c: Decision fails closed with 422 BILLING_INVALID_RECONCILIATION_EVIDENCE when provider log contains matching dispatched correlation ID", async () => {
    const { reconCase, admission, correlationId, admittedAt } = await seedReconciliationCase();

    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);

    // Provider log contains the invocation's correlation ID -> dispatch actually happened!
    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-dispatched-found-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [
        {
          requestId: "req-actual-dispatch-01",
          timestamp: new Date(admittedAt.getTime() + 5000).toISOString(),
          correlationId, // Request actually dispatched!
        },
      ],
    });

    const payload: ReconciliationCaseDecisionRequest = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: `recon-dispatch-found-${admission.invocationId}`,
      auditRationale: "Attempting to claim no-usage despite dispatched log entry",
      providerLogArtifactId: artifact.artifactId,
    };

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    assert.equal(res.status, 422, "Dispatched log record must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.invalidReconciliationEvidence);
  });

  it("RECON-RED-05d: Decision fails closed with 422 BILLING_INVALID_RECONCILIATION_EVIDENCE when artifact has verified=true but hash mismatch", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase();
    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);

    // Create an artifact where rawContent produces a different SHA256 than stored sha256
    const artifact = await prisma.providerLogArtifact.create({
      data: {
        artifactId: `art-tampered-hash-${admission.invocationId}`,
        provider: "anthropic",
        source: "PROVIDER_EXPORT_VERIFIED",
        signingKeyId: anthropicKeypair.keyId,
        providerSignature: "dummy-sig",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        coverageStart,
        coverageEnd,
        finalizedWatermark: coverageEnd,
        rawContent: JSON.stringify([]),
        verified: true, // Marked verified in DB, but content hash differs!
        ingestedBy: "system-test",
      },
    });

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-tampered-hash-${admission.invocationId}`,
        auditRationale: "Attempting decision with tampered content hash",
        providerLogArtifactId: artifact.artifactId,
      });

    assert.equal(res.status, 422, "Tampered artifact hash must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.invalidReconciliationEvidence);
  });

  it("RECON-RED-05e: Decision fails closed with 422 BILLING_INVALID_RECONCILIATION_EVIDENCE when artifact provider does not match case/admission provider", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase();
    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);

    // Provider is openai, but case provider is anthropic!
    const rawContent = JSON.stringify([]);
    const sha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
    const artifact = await prisma.providerLogArtifact.create({
      data: {
        artifactId: `art-provider-mismatch-${admission.invocationId}`,
        provider: "openai", // Case expects anthropic!
        source: "PROVIDER_EXPORT_VERIFIED",
        providerSignature: "dummy-sig",
        sha256,
        coverageStart,
        coverageEnd,
        finalizedWatermark: coverageEnd,
        rawContent,
        verified: true,
        ingestedBy: "system-test",
      },
    });

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-provider-mismatch-${admission.invocationId}`,
        auditRationale: "Attempting decision with mismatched provider artifact",
        providerLogArtifactId: artifact.artifactId,
      });

    assert.equal(res.status, 422, "Mismatched provider artifact must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.invalidReconciliationEvidence);
  });

  it("RECON-RED-05f: Decision fails closed with 422 BILLING_INCOMPLETE_RECONCILIATION_WINDOW when watermark is missing or unfinalized", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase();
    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);

    // Watermark is null (unfinalized export)
    const rawContent = JSON.stringify([]);
    const sha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
    const artifact = await prisma.providerLogArtifact.create({
      data: {
        artifactId: `art-missing-watermark-${admission.invocationId}`,
        provider: "anthropic",
        source: "PROVIDER_EXPORT_VERIFIED",
        providerSignature: "dummy-sig",
        sha256,
        coverageStart,
        coverageEnd,
        finalizedWatermark: null, // Missing watermark!
        rawContent,
        verified: true,
        ingestedBy: "system-test",
      },
    });

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-missing-watermark-${admission.invocationId}`,
        auditRationale: "Attempting decision with unwatermarked artifact",
        providerLogArtifactId: artifact.artifactId,
      });

    assert.equal(res.status, 422, "Missing watermark must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.incompleteReconciliationWindow);
  });

  it("RECON-RED-05g: Decision fails closed with 422 BILLING_INVALID_RECONCILIATION_EVIDENCE when artifact has valid hash and verified=true but forged providerSignature", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase();
    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);

    // Artifact has perfectly valid rawContent & sha256, verified=true in PostgreSQL, but forged providerSignature
    const rawContent = JSON.stringify([]);
    const sha256 = crypto.createHash("sha256").update(rawContent).digest("hex");
    const artifact = await prisma.providerLogArtifact.create({
      data: {
        artifactId: `art-forged-signature-${admission.invocationId}`,
        provider: "anthropic",
        source: "PROVIDER_EXPORT_VERIFIED",
        signingKeyId: anthropicKeypair.keyId,
        providerSignature: "dummy-forged-signature-base64", // Forged signature!
        sha256, // Valid hash!
        coverageStart,
        coverageEnd,
        finalizedWatermark: coverageEnd,
        rawContent,
        verified: true, // Marked verified=true in DB, but signature is forged!
        ingestedBy: "system-test",
      },
    });

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-forged-signature-${admission.invocationId}`,
        auditRationale: "Attempting decision with forged provider signature",
        providerLogArtifactId: artifact.artifactId,
      });

    assert.equal(res.status, 422, "Forged provider signature must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.invalidReconciliationEvidence);
  });

  it("RECON-RED-05h: Decision fails closed with 422 BILLING_INCOMPLETE_RECONCILIATION_WINDOW when admission was consumed and coverageEnd is before consumedAt + 300s", async () => {
    const now = Date.now();
    // Backdate admission: admitted 15m ago, expired 10m ago, consumed 9m ago
    // consumedAt + 300s = 9m ago + 5m = 4m ago
    const admittedAt = new Date(now - 900_000);
    const expiresAt = new Date(now - 600_000);
    const consumedAt = new Date(now - 540_000); // 9m ago
    // Required minimum coverageEnd = max(expiresAt, consumedAt + 300s) = now - 240_000 (4m ago)

    const { reconCase, admission } = await seedReconciliationCase();
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.id },
      data: {
        admittedAt,
        expiresAt,
        consumedAt,
      },
    });

    // Provide an artifact whose coverage ends at now - 400_000 (6.6m ago).
    // Note: now - 400_000 is AFTER expiresAt (now - 600_000), but BEFORE consumedAt + 300s (now - 240_000)!
    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(now - 400_000);

    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-consumed-timeout-gap-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      finalizedWatermark: coverageEnd,
      entries: [],
    });

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-consumed-gap-${admission.invocationId}`,
        auditRationale: "Attempting decision with log ending before consumedAt + 300s",
        providerLogArtifactId: artifact.artifactId,
      });

    assert.equal(res.status, 422, "Coverage window ending before consumedAt + 300s must fail closed with 422");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.incompleteReconciliationWindow);
  });

  // =========================================================================
  // RECON-RED-06: Holding vs Releasing Slot
  // =========================================================================
  it("RECON-RED-06: Holding vs releasing slot: CONFIRM_NO_USAGE releases slot, FLAG_INTEGRITY_REVIEW retains exposure", async () => {
    // Scenario A: CONFIRM_NO_USAGE releases slot
    const caseA = await seedReconciliationCase({ exposureMicrocredits: 2_000_000n });
    const coverageStartA = new Date(caseA.admittedAt.getTime() - 60_000);
    const coverageEndA = new Date(Date.now() - 60_000);
    const artifactA = await seedVerifiedProviderLog({
      artifactId: `art-release-slot-${caseA.admission.invocationId}`,
      coverageStart: coverageStartA,
      coverageEnd: coverageEndA,
      entries: [],
    });

    const decideRelease = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${caseA.reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-release-slot-${caseA.admission.invocationId}`,
        auditRationale: "Provider logs prove zero usage: release exposure",
        providerLogArtifactId: artifactA.artifactId,
      });
    assert.equal(decideRelease.status, 200);
    assert.equal(successBody<ReconciliationCaseDecisionResponse>(decideRelease).slotReleased, true);

    const admA = await prisma.billableInvocationAdmission.findUniqueOrThrow({
      where: { id: caseA.admission.id },
    });
    assert.equal(admA.maximumExposureMicrocredits, 0n, "CONFIRM_NO_USAGE must zero out maximum exposure");

    // Scenario B: FLAG_INTEGRITY_REVIEW preserves exposure
    const caseB = await seedReconciliationCase({ exposureMicrocredits: 4_000_000n });
    const decideHold = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${caseB.reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview,
        idempotencyKey: `idem-hold-slot-${caseB.admission.invocationId}`,
        auditRationale: "Evidence is ambiguous: maintaining exposure under integrity review",
      });
    assert.equal(decideHold.status, 200);
    assert.equal(successBody<ReconciliationCaseDecisionResponse>(decideHold).slotReleased, false);

    const admB = await prisma.billableInvocationAdmission.findUniqueOrThrow({
      where: { id: caseB.admission.id },
    });
    assert.equal(
      admB.maximumExposureMicrocredits,
      4_000_000n,
      "FLAG_INTEGRITY_REVIEW must strictly retain maximum exposure",
    );
    const caseBUpdated = await prisma.billingReconciliationCase.findUniqueOrThrow({
      where: { caseId: caseB.reconCase.caseId },
    });
    assert.equal(caseBUpdated.state, RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW);
  });

  // =========================================================================
  // RECON-RED-07: Concurrency Serialization (Two Concurrent Decisions Race)
  // =========================================================================
  it("RECON-RED-07: Two concurrent decisions on the same case serialize under row lock without 500 error", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase({
      exposureMicrocredits: 5_000_000n,
    });

    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);
    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-race-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [],
    });

    // Request 1: Decision to CONFIRM_NO_USAGE
    const req1 = httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `race-key-01-${admission.invocationId}`,
        auditRationale: "Concurrent request 1: confirm no usage",
        providerLogArtifactId: artifact.artifactId,
      });

    // Request 2: Decision to FLAG_INTEGRITY_REVIEW (different decision!)
    const req2 = httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview,
        idempotencyKey: `race-key-02-${admission.invocationId}`,
        auditRationale: "Concurrent request 2: flag integrity review",
      });

    const [res1, res2] = await Promise.all([req1, req2]);

    assert.notEqual(res1.status, 500, "Request 1 must never fail with unhandled 500 collision");
    assert.notEqual(res2.status, 500, "Request 2 must never fail with unhandled 500 collision");

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      `Expected one winner (200) and one conflict (409), got [${res1.status}, ${res2.status}]`,
    );
  });

  // =========================================================================
  // RECON-RED-08: Idempotency Parity & Conflict Detection
  // =========================================================================
  it("RECON-RED-08: Idempotent replay returns existing result; conflicting replay returns 409", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase();

    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);
    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-idem-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [],
    });

    const payload: ReconciliationCaseDecisionRequest = {
      decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
      idempotencyKey: `recon-idem-${admission.invocationId}`,
      auditRationale: "Original audited decision rationale for idempotency test",
      providerLogArtifactId: artifact.artifactId,
    };

    // 1. Initial decision -> 200 OK
    const firstRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);
    assert.equal(firstRes.status, 200);
    const firstData = successBody<ReconciliationCaseDecisionResponse>(firstRes);

    // 2. Exact replay -> 200 OK replay returning historical snapshot
    const replayRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);
    assert.equal(replayRes.status, 200);
    const replayData = successBody<ReconciliationCaseDecisionResponse>(replayRes);
    assert.equal(replayData.caseId, firstData.caseId);
    assert.equal(replayData.decidedAt, firstData.decidedAt);

    // 3. Conflicting replay (same idempotencyKey, but altered decision/rationale) -> 409 Conflict
    const conflictingPayload: ReconciliationCaseDecisionRequest = {
      decision: RECONCILIATION_DECISION_ACTIONS.escalate,
      idempotencyKey: payload.idempotencyKey,
      auditRationale: "Altered decision rationale under the same idempotency key",
    };

    const conflictRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(conflictingPayload);
    assert.equal(conflictRes.status, 409, "Conflicting replay must return 409");
    assert.equal(problemBody(conflictRes).code, BILLING_ERROR_CODES.idempotencyConflict);

    // 4. Conflicting replay (same idempotencyKey, same decision & rationale, but altered providerLogArtifactId) -> 409 Conflict
    const artifactB = await seedVerifiedProviderLog({
      artifactId: `art-idem-alt-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [],
    });

    const conflictingArtifactPayload: ReconciliationCaseDecisionRequest = {
      decision: payload.decision,
      idempotencyKey: payload.idempotencyKey,
      auditRationale: payload.auditRationale,
      providerLogArtifactId: artifactB.artifactId,
    };

    const conflictArtRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(conflictingArtifactPayload);
    assert.equal(conflictArtRes.status, 409, "Conflicting artifactId replay must return 409");
    assert.equal(problemBody(conflictArtRes).code, BILLING_ERROR_CODES.idempotencyConflict);
  });

  // =========================================================================
  // RECON-RED-09: Late Receipt Arrival & Terminal Precedence
  // =========================================================================
  it("RECON-RED-09a: Late receipt arriving after Admin CONFIRM_NO_USAGE cannot overwrite outcome or charge wallet", async () => {
    const { reconCase, admission, admittedAt, capabilityToken } = await seedReconciliationCase({
      exposureMicrocredits: 3_000_000n,
    });

    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);
    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-late-precedence-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [],
    });

    // 1. Admin confirms no usage
    const adminDecision = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-precedence-${admission.invocationId}`,
        auditRationale: "Audited no-usage before late receipt",
        providerLogArtifactId: artifact.artifactId,
      });
    assert.equal(adminDecision.status, 200);

    // 2. Late worker receipt arrives claiming usage
    const lateReceipt = await httpRequest(app)
      .post("/internal/billing/usage/settle")
      .set("x-worker-api-key", WORKER_TEST_API_KEY)
      .send({
        admissionId: admission.id,
        invocationId: admission.invocationId,
        capabilityToken,
        attemptOrdinal: 1,
        providerCompletionState: PROVIDER_COMPLETION_STATES.COMPLETED,
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
      });

    // Terminal precedence: must fail closed with 409 Conflict
    assert.equal(lateReceipt.status, 409, "Late receipt must be rejected with 409 when case is already CONFIRMED_NO_USAGE");
    assert.equal(problemBody(lateReceipt).code, BILLING_ERROR_CODES.reconciliationAlreadyResolved);

    // Conflicting evidence appended to INTEGRITY_REVIEW, wallet remains untouched
    const updatedCase = await prisma.billingReconciliationCase.findUniqueOrThrow({
      where: { caseId: reconCase.caseId },
    });
    assert.equal(updatedCase.state, RECONCILIATION_CASE_STATES.INTEGRITY_REVIEW);
    assert.ok(updatedCase.conflictingPayload !== null, "Must record conflicting late receipt payload");

    const wallet = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: customerWalletId },
    });
    assert.equal(wallet.balanceMicrocredits, 100_000_000n, "Wallet balance must remain completely uncharged");
  });

  it("RECON-RED-09b: Late settlement arriving before Admin decision causes subsequent decision to fail closed with 409", async () => {
    const { reconCase, admission, admittedAt } = await seedReconciliationCase({
      exposureMicrocredits: 2_000_000n,
    });

    // 1. Late settlement arrives and transitions admission to SETTLED
    await prisma.billableInvocationAdmission.update({
      where: { id: admission.id },
      data: { state: ADMISSION_STATES.SETTLED, settledAt: new Date() },
    });

    const coverageStart = new Date(admittedAt.getTime() - 60_000);
    const coverageEnd = new Date(Date.now() - 60_000);
    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-late-settled-before-${admission.invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [],
    });

    // 2. Admin attempts to decide CONFIRM_NO_USAGE on already settled admission
    const decideRes = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-late-settle-${admission.invocationId}`,
        auditRationale: "Attempting to confirm no-usage on already settled admission",
        providerLogArtifactId: artifact.artifactId,
      });

    assert.equal(decideRes.status, 409, "Must fail closed with 409 when admission was already settled");
    assert.equal(problemBody(decideRes).code, BILLING_ERROR_CODES.admissionAlreadySettled);
  });

  // =========================================================================
  // RECON-RED-11: Rejection of Decision When Admission Is IN_FLIGHT
  // =========================================================================
  it("RECON-RED-11: Decision fails closed with 409 BILLING_ADMISSION_INVALID_STATE when admission is still IN_FLIGHT", async () => {
    // Seed admission in IN_FLIGHT state
    const invocationId = crypto.randomUUID();
    const admissionId = crypto.randomUUID();
    const caseId = `case-${invocationId}`;
    const correlationId = `corr-${invocationId}`;

    await prisma.billableInvocationAdmission.create({
      data: {
        id: admissionId,
        invocationId,
        correlationId,
        admissionRequestId: `req-${invocationId}`,
        requestFingerprint: `fp-${invocationId}`,
        logicalOperationId: `op-${invocationId}`,
        attemptOrdinal: 1,
        fundingPrincipal: "CUSTOMER_WALLET",
        userId: customerUserId,
        walletId: customerWalletId,
        runId: `run-${invocationId}`,
        agentRole: "code-reviewer",
        operationType: "model_call",
        requestedModel: "claude-3-5-sonnet",
        resolvedProvider: "anthropic",
        resolvedModel: "claude-3-5-sonnet",
        runtimePolicyVersion: "v1",
        rolloutMode: BILLING_ROLLOUT_MODES.TELEMETRY_ONLY,
        debitMode: MODEL_USAGE_DEBIT_MODES.OFF,
        appliedMaxOutputTokens: 4096,
        maximumExposureMicrocredits: 5_000_000n,
        initialExposureMicrocredits: 5_000_000n,
        capabilityDigest: crypto.createHash("sha256").update("cap-test").digest("hex"),
        state: ADMISSION_STATES.IN_FLIGHT, // Actively in flight!
        version: 1,
        admittedAt: new Date(Date.now() - 600_000),
        expiresAt: new Date(Date.now() - 120_000),
      },
    });

    const reconCase = await prisma.billingReconciliationCase.create({
      data: {
        caseId,
        invocationId,
        admissionId,
        state: RECONCILIATION_CASE_STATES.OPEN,
        provider: "anthropic",
        providerCorrelationId: correlationId,
        version: 1,
      },
    });

    const coverageStart = new Date(Date.now() - 700_000);
    const coverageEnd = new Date(Date.now() - 60_000);
    const artifact = await seedVerifiedProviderLog({
      artifactId: `art-inflight-${invocationId}`,
      coverageStart,
      coverageEnd,
      entries: [],
    });

    const res = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.confirmNoUsage,
        idempotencyKey: `idem-inflight-${invocationId}`,
        auditRationale: "Attempting CONFIRM_NO_USAGE while admission is still in flight",
        providerLogArtifactId: artifact.artifactId,
      });

    assert.equal(res.status, 409, "Deciding no-usage on IN_FLIGHT admission must fail with 409");
    assert.equal(problemBody(res).code, BILLING_ERROR_CODES.admissionInvalidState);
  });

  // =========================================================================
  // RECON-RED-12: Enforce Case State Transition Matrix
  // =========================================================================
  it("RECON-RED-12: Decision fails closed with 409 when transitioning from an invalid case state (e.g. EVIDENCE_PENDING -> MAINTAIN_EXPOSURE or terminal states)", async () => {
    // Scenario 1: Case is already in EVIDENCE_PENDING, attempting MAINTAIN_EXPOSURE
    const casePending = await seedReconciliationCase({
      state: RECONCILIATION_CASE_STATES.EVIDENCE_PENDING,
    });

    const res1 = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${casePending.reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.maintainExposure,
        idempotencyKey: `idem-invalid-trans-1-${casePending.admission.invocationId}`,
        auditRationale: "Invalid transition: already in evidence pending",
      });

    assert.equal(res1.status, 409, "Invalid state transition must return 409");
    assert.equal(problemBody(res1).code, BILLING_ERROR_CODES.reconciliationCaseInvalidState);

    // Scenario 2: Case is in terminal SETTLED_WITH_USAGE, attempting any decision
    const caseSettled = await seedReconciliationCase({
      state: RECONCILIATION_CASE_STATES.SETTLED_WITH_USAGE,
    });

    const res2 = await httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${caseSettled.reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.escalate,
        idempotencyKey: `idem-invalid-trans-2-${caseSettled.admission.invocationId}`,
        auditRationale: "Attempting to decide terminal settled case",
      });

    assert.equal(res2.status, 409, "Deciding on settled case must return 409");
    assert.equal(problemBody(res2).code, BILLING_ERROR_CODES.reconciliationAlreadyResolved);
  });

  // =========================================================================
  // RECON-RED-13: Concurrent Decisions Across Different Cases/Wallets With Same Idempotency Key
  // =========================================================================
  it("RECON-RED-13: Two concurrent decisions on two different cases/wallets with the same idempotency key resolve cleanly without 500 collision (one 200, one 409)", async () => {
    // Create customer 2 with wallet 2
    const user2 = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: `recon-customer-2-${Date.now()}@example.com`,
        displayName: "Customer 2",
        role: AUTH_USER_ROLES.customer,
        passwordHash: "dummy-password-hash-32-chars-long",
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
    const wallet2 = await prisma.billingWallet.create({
      data: {
        userId: user2.id,
        balanceMicrocredits: 50_000_000n,
        availableCredits: 50n,
        accountingUnitVersion: 2,
        version: 1,
      },
    });

    // Case 1 on Wallet 1 (customerUserId)
    const case1 = await seedReconciliationCase({ exposureMicrocredits: 2_000_000n });
    // Case 2 on Wallet 2 (user2.id)
    const case2 = await seedReconciliationCase({
      exposureMicrocredits: 3_000_000n,
    });
    // Link case2 to customer2's wallet
    await prisma.billableInvocationAdmission.update({
      where: { id: case2.admission.id },
      data: {
        userId: user2.id,
        walletId: wallet2.id,
      },
    });

    const sharedIdempotencyKey = `idem-cross-case-race-${case1.admission.invocationId}`;

    const req1 = httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${case1.reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview,
        idempotencyKey: sharedIdempotencyKey,
        auditRationale: "Decision on Case 1 using shared idempotency key",
      });

    const req2 = httpRequest(app)
      .post(`/admin/billing/reconciliation/cases/${case2.reconCase.caseId}/decide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        decision: RECONCILIATION_DECISION_ACTIONS.flagIntegrityReview,
        idempotencyKey: sharedIdempotencyKey,
        auditRationale: "Decision on Case 2 using same shared idempotency key",
      });

    const [res1, res2] = await Promise.all([req1, req2]);

    assert.notEqual(res1.status, 500, "Request 1 must never fail with unhandled 500");
    assert.notEqual(res2.status, 500, "Request 2 must never fail with unhandled 500");

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      `Expected one winner (200) and one conflict (409), got [${res1.status}, ${res2.status}]`,
    );

    const conflictRes = res1.status === 409 ? res1 : res2;
    assert.equal(problemBody(conflictRes).code, BILLING_ERROR_CODES.idempotencyConflict);
  });

  // =========================================================================
  // RECON-RED-10: Operational Invariants Verification
  // =========================================================================
  it("RECON-RED-10: Operates strictly with MODEL_USAGE_DEBIT=OFF and PROVIDER_RECONCILIATION_AUTOMATED_RELEASE=OFF", () => {
    assert.equal(process.env.MODEL_USAGE_DEBIT, "OFF", "MODEL_USAGE_DEBIT must remain OFF");
    assert.equal(
      process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE,
      "OFF",
      "PROVIDER_RECONCILIATION_AUTOMATED_RELEASE must remain OFF",
    );
  });
});
