import * as assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  BILLING_ERROR_CODES,
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  MODEL_PRICING_PREVIEW_SOURCES,
  MODEL_PRICING_SCOPES,
  MODEL_PRICING_AUDIT_EVENT_TYPES,
  MODEL_USAGE_DEBIT_MODES,
  PRICING_ASSIGNMENT_STATUSES,
  TOKEN_BUCKET_POLICIES,
  calculateMicrocreditCharge,
  type AdminModelPricingOverviewResponse,
  type ModelTariffDraftView,
  type ModelTariffSnapshotView,
  type PreviewModelPricingResponse,
  type PublishModelTariffDraftResponse,
  type SupersedeModelTariffAssignmentResponse,
} from "@lcsp/contracts/billing";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import {
  MODEL_PRICING_FINGERPRINT_ACTIONS,
  computeModelPricingRequestFingerprint,
} from "../src/modules/billing/domain/model-pricing-fingerprint.js";
import { BillingUsageKernel } from "../src/modules/billing/application/shared/billing-usage.kernel.js";
import { ModelPricingInvalidIntervalError } from "../src/modules/billing/domain/billing.errors.js";
import type { BillingTransactionPort } from "../src/modules/billing/domain/repositories/billing-transaction.port.js";
import { mapPrismaModelPricingPersistenceError } from "../src/modules/billing/infrastructure/persistence/prisma-model-pricing-error.js";
import {
  TEST_DATABASE_URL,
  ensureMigratedSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemBody, successBody } from "./support/http.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(testDir, "..");

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

describe("Admin model pricing governance (Postgres e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    await ensureMigratedSchema();
    ensureIdempotentMigrateDeploy();

    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const [overlapConstraints, snapshotTriggers] = await Promise.all([
      prisma.$queryRaw<Array<{ conname: string }>>`
        SELECT conname
        FROM pg_constraint
        WHERE conname = 'CustomerModelTariffAssignment_no_overlap'
      `,
      prisma.$queryRaw<Array<{ tgname: string }>>`
        SELECT tgname
        FROM pg_trigger
        WHERE tgname = 'CustomerModelTariffSnapshot_immutable'
      `,
    ]);

    assert.equal(
      overlapConstraints.length,
      1,
      "CustomerModelTariffAssignment_no_overlap GiST exclusion constraint must exist in migrated schema",
    );
    assert.equal(
      snapshotTriggers.length,
      1,
      "CustomerModelTariffSnapshot_immutable trigger must exist in migrated schema",
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    // Why: PostgreSQL requires every referencing table in a TRUNCATE statement, and
    // reconciliation cases now reference admissions. Enumerating the exact WP8 tables
    // keeps this test reset bounded; CASCADE could silently clear unrelated fixtures.
    // TRUNCATE preserves the immutable snapshot UPDATE/DELETE trigger invariant.
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "BillingReconciliationCase",
        "ModelOutputEvaluation",
        "ModelUsageReceipt",
        "BillableInvocationAdmission",
        "CustomerModelTariffAssignment",
        "CustomerModelTariffSnapshot",
        "CustomerModelTariffDraft"
    `);
    await prisma.auditEvent.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("enforces Admin RBAC (401 unauthenticated, 403 non-admin) across all 8 endpoints", async () => {
    const routes: Array<{
      method: "get" | "post" | "patch";
      path: string;
      body?: Record<string, unknown>;
    }> = [
      { method: "get", path: "/admin/billing/model-pricing" },
      { method: "get", path: "/admin/billing/model-pricing/drafts/draft-1" },
      {
        method: "get",
        path: "/admin/billing/model-pricing/snapshots/snap-1",
      },
      {
        method: "post",
        path: "/admin/billing/model-pricing/drafts",
        body: {},
      },
      {
        method: "patch",
        path: "/admin/billing/model-pricing/drafts/draft-1",
        body: {},
      },
      {
        method: "post",
        path: "/admin/billing/model-pricing/preview",
        body: {},
      },
      {
        method: "post",
        path: "/admin/billing/model-pricing/drafts/draft-1/publish",
        body: {},
      },
      {
        method: "post",
        path: "/admin/billing/model-pricing/assignments/assign-1/supersede",
        body: {},
      },
    ];

    for (const route of routes) {
      const unauthReq = httpRequest(app)[route.method](route.path);
      const unauthRes = route.body
        ? await unauthReq.send(route.body)
        : await unauthReq;
      assert.equal(
        unauthRes.status,
        401,
        `Expected 401 for unauthenticated ${route.method.toUpperCase()} ${route.path}`,
      );
      const unauthProblem = problemBody(unauthRes);
      assert.equal(unauthProblem.status, 401);

      const customerReq = httpRequest(app)
        [route.method](route.path)
        .set("Authorization", `Bearer ${customerToken}`);
      const customerRes = route.body
        ? await customerReq.send(route.body)
        : await customerReq;
      assert.equal(
        customerRes.status,
        403,
        `Expected 403 for customer ${route.method.toUpperCase()} ${route.path}`,
      );
      const customerProblem = problemBody(customerRes);
      assert.equal(customerProblem.status, 403);
    }
  });

  it("supports draft CRUD with optimistic versioning, atomic publish + AuditEvent, idempotent replay, conflict detection, and preview parity", async () => {
    const createRes = await httpRequest(app)
      .post("/admin/billing/model-pricing/drafts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        scope: MODEL_PRICING_SCOPES.exactModel,
        provider: "ANTHROPIC",
        resolvedModel: "claude-sonnet-4-6",
        inputMicrocreditsPerMillion: "3000000",
        outputMicrocreditsPerMillion: "15000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cachedInputMicrocreditsPerMillion: "300000",
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        operationalAssumptions: {
          providerPriceSource: "Anthropic Direct",
          notes: "WP8 Phase B2 initial draft",
        },
      });
    assert.equal(createRes.status, 201);
    const createdDraft = successBody<ModelTariffDraftView>(createRes);
    assert.equal(createdDraft.status, CUSTOMER_TARIFF_DRAFT_STATUSES.draft);
    assert.equal(createdDraft.version, 1);
    assert.equal(
      createdDraft.normalizedScopeKey,
      "EXACT_MODEL:anthropic:claude-sonnet-4-6",
    );

    const getDraftRes = await httpRequest(app)
      .get(`/admin/billing/model-pricing/drafts/${createdDraft.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(getDraftRes.status, 200);
    assert.equal(
      successBody<ModelTariffDraftView>(getDraftRes).id,
      createdDraft.id,
    );

    const updateRes = await httpRequest(app)
      .patch(`/admin/billing/model-pricing/drafts/${createdDraft.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        expectedVersion: 1,
        inputMicrocreditsPerMillion: "3200000",
      });
    assert.equal(updateRes.status, 200);
    const updatedDraft = successBody<ModelTariffDraftView>(updateRes);
    assert.equal(updatedDraft.version, 2);
    assert.equal(updatedDraft.inputMicrocreditsPerMillion, "3200000");

    // Stale version update must fail with 409 MODEL_PRICING_STALE_DRAFT
    const staleUpdateRes = await httpRequest(app)
      .patch(`/admin/billing/model-pricing/drafts/${createdDraft.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        expectedVersion: 1,
        inputMicrocreditsPerMillion: "3300000",
      });
    assert.equal(staleUpdateRes.status, 409);
    const staleProblem = problemBody(staleUpdateRes);
    assert.equal(staleProblem.status, 409);
    assert.equal(staleProblem.code, BILLING_ERROR_CODES.modelPricingStaleDraft);

    // Publish atomically
    const effectiveFrom = new Date(Date.now() - 60_000).toISOString();
    const publishAuditReason = "Publish initial Anthropic Claude Sonnet tariff";
    const publishFingerprint = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      draftId: updatedDraft.id,
      expectedDraftVersion: 2,
      scope: MODEL_PRICING_SCOPES.exactModel,
      provider: "anthropic",
      resolvedModel: "claude-sonnet-4-6",
      effectiveFrom,
      effectiveTo: null,
      auditReason: publishAuditReason,
      rates: {
        inputMicrocreditsPerMillion: "3200000",
        outputMicrocreditsPerMillion: "15000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
        cachedInputMicrocreditsPerMillion: "300000",
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
    });

    const publishPayload = {
      idempotencyKey: "e2e-pub-key-1",
      requestFingerprint: publishFingerprint,
      auditReason: publishAuditReason,
      expectedDraftVersion: 2,
      effectiveFrom,
      effectiveTo: null,
    };

    const publishRes = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${updatedDraft.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(publishPayload);
    assert.equal(publishRes.status, 201);
    const published = successBody<PublishModelTariffDraftResponse>(publishRes);
    assert.equal(published.idempotentReplay, false);
    assert.equal(
      published.draft.status,
      CUSTOMER_TARIFF_DRAFT_STATUSES.published,
    );
    assert.equal(published.snapshot.version, 1);
    assert.equal(
      published.assignment.status,
      PRICING_ASSIGNMENT_STATUSES.active,
    );

    const auditRows = await prisma.auditEvent.findMany({
      where: {
        id: published.auditEventId,
      },
    });
    assert.equal(auditRows.length, 1);
    assert.equal(
      auditRows[0]?.eventType,
      MODEL_PRICING_AUDIT_EVENT_TYPES.published,
    );
    assert.equal(
      auditRows[0]?.resourceType,
      AUDIT_RESOURCE_TYPES.customerModelTariff,
    );
    assert.equal(auditRows[0]?.actorId, "user-3");

    // Get snapshot endpoint
    const snapshotRes = await httpRequest(app)
      .get(`/admin/billing/model-pricing/snapshots/${published.snapshot.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(snapshotRes.status, 200);
    assert.equal(
      successBody<ModelTariffSnapshotView>(snapshotRes).id,
      published.snapshot.id,
    );

    // Exact idempotent replay succeeds with idempotentReplay: true and no duplicate rows
    const replayRes = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${updatedDraft.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(publishPayload);
    assert.equal(replayRes.status, 201);
    const replayed = successBody<PublishModelTariffDraftResponse>(replayRes);
    assert.equal(replayed.idempotentReplay, true);
    assert.equal(replayed.snapshot.id, published.snapshot.id);
    assert.equal(replayed.assignment.id, published.assignment.id);
    assert.equal(replayed.auditEventId, published.auditEventId);
    assert.equal(await prisma.customerModelTariffSnapshot.count(), 1);
    assert.equal(await prisma.customerModelTariffAssignment.count(), 1);

    // Conflicting payload with same idempotencyKey returns 409 BILLING_IDEMPOTENCY_CONFLICT
    const conflictRes = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${updatedDraft.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        ...publishPayload,
        auditReason: "Conflicting altered reason",
      });
    assert.equal(conflictRes.status, 409);
    const conflictProblem = problemBody(conflictRes);
    assert.equal(conflictProblem.status, 409);
    assert.equal(conflictProblem.code, BILLING_ERROR_CODES.idempotencyConflict);

    // Editing a PUBLISHED draft returns 409 MODEL_PRICING_IMMUTABLE_SNAPSHOT
    const editPublishedRes = await httpRequest(app)
      .patch(`/admin/billing/model-pricing/drafts/${updatedDraft.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        expectedVersion: published.draft.version,
        inputMicrocreditsPerMillion: "9999999",
      });
    assert.equal(editPublishedRes.status, 409);
    assert.equal(
      problemBody(editPublishedRes).code,
      BILLING_ERROR_CODES.modelPricingImmutableSnapshot,
    );

    // Overview reflects coverage, debitMode=OFF, active assignment, snapshot, draft
    const overviewRes = await httpRequest(app)
      .get("/admin/billing/model-pricing")
      .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(overviewRes.status, 200);
    const overview =
      successBody<AdminModelPricingOverviewResponse>(overviewRes);
    assert.equal(overview.debitMode, MODEL_USAGE_DEBIT_MODES.OFF);
    assert.equal(overview.snapshots.length, 1);
    assert.equal(overview.assignments.length, 1);
    assert.equal(overview.drafts.length, 1);
    const claudeCoverage = overview.coverage.find(
      (row) =>
        row.provider === "anthropic" &&
        row.resolvedModel === "claude-sonnet-4-6",
    );
    assert.ok(claudeCoverage);
    assert.equal(claudeCoverage.hasCoverage, true);
    assert.equal(claudeCoverage.resolvedScope, MODEL_PRICING_SCOPES.exactModel);

    // Preview matches exact integer math of BillingUsageKernel & calculateMicrocreditCharge
    const previewRes = await httpRequest(app)
      .post("/admin/billing/model-pricing/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        usage: {
          inputTokens: "1234",
          outputTokens: "567",
          cachedInputTokens: "89",
        },
      });
    assert.equal(previewRes.status, 200);
    const preview = successBody<PreviewModelPricingResponse>(previewRes);
    assert.equal(preview.debitMode, MODEL_USAGE_DEBIT_MODES.OFF);
    assert.equal(
      preview.source,
      MODEL_PRICING_PREVIEW_SOURCES.activeAssignment,
    );
    assert.equal(preview.snapshotId, published.snapshot.id);

    const kernel = new BillingUsageKernel(
      {} as unknown as BillingTransactionPort,
    );
    const rates = {
      input: 3_200_000n,
      output: 15_000_000n,
      reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
      cachedInputPolicy: TOKEN_BUCKET_POLICIES.separateRate,
      cachedInput: 300_000n,
      cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
    };
    const kernelAdmission = kernel.issueModelUsageAdmission({
      invocationId: "inv-e2e-parity",
      walletId: "wallet-1",
      spendableMicrocredits: 100_000_000n,
      inFlightCount: 0,
      resolvedModel: "claude-sonnet-4-6",
      provider: "anthropic",
      allowlistedModels: ["claude-sonnet-4-6"],
      availableScopes: [MODEL_PRICING_SCOPES.exactModel],
      pricingSnapshotId: published.snapshot.id,
      maxInputTokens: 1234n,
      maxOutputTokens: 567n,
      maxCachedInputTokens: 89n,
      ratesMicrocreditsPerMillion: rates,
    });
    const expectedCharge = calculateMicrocreditCharge({
      usage: {
        inputTokens: 1234n,
        outputTokens: 567n,
        cachedInputTokens: 89n,
      },
      ratesMicrocreditsPerMillion: rates,
    });
    assert.equal(preview.chargeMicrocredits, expectedCharge.toString());
    assert.equal(
      preview.chargeMicrocredits,
      kernelAdmission.maximumExposureMicrocredits.toString(),
    );

    // Unlisted model fails closed with 422 MODEL_PRICING_UNLISTED_MODEL even if GLOBAL_DEFAULT exists
    const unlistedRes = await httpRequest(app)
      .post("/admin/billing/model-pricing/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        provider: "anthropic",
        resolvedModel: "claude-unlisted-99",
        usage: { inputTokens: "100", outputTokens: "50" },
      });
    assert.equal(unlistedRes.status, 422);
    assert.equal(
      problemBody(unlistedRes).code,
      BILLING_ERROR_CODES.modelPricingUnlistedModel,
    );
  });

  it("blocks overlapping [effectiveFrom, effectiveTo) intervals at Postgres 23P01 and allows adjacent intervals", async () => {
    const t1 = "2027-01-01T00:00:00.000Z";
    const t2 = "2027-02-01T00:00:00.000Z";
    const tOverlap = "2027-01-15T00:00:00.000Z";

    const createDraft = async (inputRate: string) => {
      const res = await httpRequest(app)
        .post("/admin/billing/model-pricing/drafts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: inputRate,
          outputMicrocreditsPerMillion: "10000000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        });
      return successBody<ModelTariffDraftView>(res);
    };

    const draftA = await createDraft("1000000");
    const fpA = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      draftId: draftA.id,
      expectedDraftVersion: 1,
      scope: MODEL_PRICING_SCOPES.globalDefault,
      effectiveFrom: t1,
      effectiveTo: t2,
      auditReason: "Window A",
      rates: {
        inputMicrocreditsPerMillion: "1000000",
        outputMicrocreditsPerMillion: "10000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
    });
    const pubA = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${draftA.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "overlap-pub-a",
        requestFingerprint: fpA,
        auditReason: "Window A",
        expectedDraftVersion: 1,
        effectiveFrom: t1,
        effectiveTo: t2,
      });
    assert.equal(pubA.status, 201);

    // Overlapping [tOverlap, null) must trigger Postgres 23P01 -> 409 MODEL_PRICING_OVERLAP_CONFLICT with rollback
    const draftB = await createDraft("2000000");
    const fpB = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      draftId: draftB.id,
      expectedDraftVersion: 1,
      scope: MODEL_PRICING_SCOPES.globalDefault,
      effectiveFrom: tOverlap,
      effectiveTo: null,
      auditReason: "Overlapping window",
      rates: {
        inputMicrocreditsPerMillion: "2000000",
        outputMicrocreditsPerMillion: "10000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
    });
    const overlapRes = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${draftB.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "overlap-pub-b",
        requestFingerprint: fpB,
        auditReason: "Overlapping window",
        expectedDraftVersion: 1,
        effectiveFrom: tOverlap,
        effectiveTo: null,
      });
    assert.equal(overlapRes.status, 409);
    assert.equal(
      problemBody(overlapRes).code,
      BILLING_ERROR_CODES.modelPricingOverlapConflict,
    );
    // Transaction rolled back cleanly: only 1 snapshot exists
    assert.equal(await prisma.customerModelTariffSnapshot.count(), 1);

    // Adjacent [t2, null) must succeed
    const fpAdjacent = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      draftId: draftB.id,
      expectedDraftVersion: 1,
      scope: MODEL_PRICING_SCOPES.globalDefault,
      effectiveFrom: t2,
      effectiveTo: null,
      auditReason: "Adjacent window",
      rates: {
        inputMicrocreditsPerMillion: "2000000",
        outputMicrocreditsPerMillion: "10000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
    });
    const adjRes = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${draftB.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "adjacent-pub-b",
        requestFingerprint: fpAdjacent,
        auditReason: "Adjacent window",
        expectedDraftVersion: 1,
        effectiveFrom: t2,
        effectiveTo: null,
      });
    assert.equal(adjRes.status, 201);
    assert.equal(await prisma.customerModelTariffAssignment.count(), 2);
  });

  it("supersedes active assignment without mutating historical snapshots and enforces CustomerModelTariffSnapshot_immutable trigger", async () => {
    const tStart = new Date(Date.now() - 3_600_000).toISOString();
    const tSupersede = new Date(Date.now() + 60_000).toISOString();

    const d1 = successBody<ModelTariffDraftView>(
      await httpRequest(app)
        .post("/admin/billing/model-pricing/drafts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000000",
          outputMicrocreditsPerMillion: "5000000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        }),
    );

    const fp1 = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      draftId: d1.id,
      expectedDraftVersion: 1,
      scope: MODEL_PRICING_SCOPES.globalDefault,
      effectiveFrom: tStart,
      effectiveTo: null,
      auditReason: "Initial global v1",
      rates: {
        inputMicrocreditsPerMillion: "1000000",
        outputMicrocreditsPerMillion: "5000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
    });

    const pub1 = successBody<PublishModelTariffDraftResponse>(
      await httpRequest(app)
        .post(`/admin/billing/model-pricing/drafts/${d1.id}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          idempotencyKey: "sup-init-1",
          requestFingerprint: fp1,
          auditReason: "Initial global v1",
          expectedDraftVersion: 1,
          effectiveFrom: tStart,
          effectiveTo: null,
        }),
    );

    const snapshotBefore =
      await prisma.customerModelTariffSnapshot.findUniqueOrThrow({
        where: { id: pub1.snapshot.id },
      });

    // Verify DB trigger blocks direct UPDATE and DELETE on CustomerModelTariffSnapshot
    await assert.rejects(
      () =>
        prisma.customerModelTariffSnapshot.update({
          where: { id: pub1.snapshot.id },
          data: { auditReason: "tamper attempt" },
        }),
      /append-only/i,
    );
    await assert.rejects(
      () =>
        prisma.customerModelTariffSnapshot.delete({
          where: { id: pub1.snapshot.id },
        }),
      /append-only/i,
    );

    // Create replacement draft and supersede assignment
    const d2 = successBody<ModelTariffDraftView>(
      await httpRequest(app)
        .post("/admin/billing/model-pricing/drafts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "2000000",
          outputMicrocreditsPerMillion: "8000000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        }),
    );

    const supFp = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
      assignmentId: pub1.assignment.id,
      effectiveFrom: tSupersede,
      effectiveTo: null,
      replacementDraftId: d2.id,
      replacementSnapshotId: null,
      auditReason: "Upgrade global tariff to v2",
    });

    const supRes = await httpRequest(app)
      .post(
        `/admin/billing/model-pricing/assignments/${pub1.assignment.id}/supersede`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "sup-exec-1",
        requestFingerprint: supFp,
        auditReason: "Upgrade global tariff to v2",
        expectedAssignmentVersion: 1,
        effectiveFrom: tSupersede,
        effectiveTo: null,
        replacementDraftId: d2.id,
        expectedDraftVersion: 1,
      });
    assert.equal(supRes.status, 201);
    const superseded =
      successBody<SupersedeModelTariffAssignmentResponse>(supRes);
    assert.equal(superseded.idempotentReplay, false);
    assert.equal(superseded.supersededAssignment.effectiveTo, tSupersede);
    assert.equal(
      superseded.supersededAssignment.supersededByAssignmentId,
      superseded.replacementAssignment.id,
    );
    assert.equal(superseded.replacementSnapshot.version, 2);

    const snapshotAfter =
      await prisma.customerModelTariffSnapshot.findUniqueOrThrow({
        where: { id: pub1.snapshot.id },
      });
    assert.deepEqual(snapshotAfter, snapshotBefore);

    // Replay supersede with same idempotencyKey + expectedAssignmentVersion=1
    const supReplayRes = await httpRequest(app)
      .post(
        `/admin/billing/model-pricing/assignments/${pub1.assignment.id}/supersede`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "sup-exec-1",
        requestFingerprint: supFp,
        auditReason: "Upgrade global tariff to v2",
        expectedAssignmentVersion: 1,
        effectiveFrom: tSupersede,
        effectiveTo: null,
        replacementDraftId: d2.id,
        expectedDraftVersion: 1,
      });
    assert.equal(supReplayRes.status, 201);
    assert.equal(
      successBody<SupersedeModelTariffAssignmentResponse>(supReplayRes)
        .idempotentReplay,
      true,
    );
  });

  it("rejects retroactive supersede with effectiveFrom between target.effectiveFrom and dbUtcNow, preserving historical resolution", async () => {
    // Why: Ensure an active assignment cannot have its historical pricing rewritten by picking a past effectiveFrom (target.effectiveFrom < tMid < dbUtcNow).
    // How: Set up active assignment from 1 hour ago (tStart), attempt to supersede with tMid (30 mins ago).
    // Invariants: Must return 422 MODEL_PRICING_INVALID_INTERVAL, rollback cleanly, and historical preview at tMid must resolve to original snapshot.
    const tStart = new Date(Date.now() - 3_600_000).toISOString();
    const tMid = new Date(Date.now() - 1_800_000).toISOString();

    const d1 = successBody<ModelTariffDraftView>(
      await httpRequest(app)
        .post("/admin/billing/model-pricing/drafts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "1000000",
          outputMicrocreditsPerMillion: "5000000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        }),
    );

    const fp1 = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      draftId: d1.id,
      expectedDraftVersion: 1,
      scope: MODEL_PRICING_SCOPES.globalDefault,
      effectiveFrom: tStart,
      effectiveTo: null,
      auditReason: "Initial active tariff",
      rates: {
        inputMicrocreditsPerMillion: "1000000",
        outputMicrocreditsPerMillion: "5000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
    });

    const pub1 = successBody<PublishModelTariffDraftResponse>(
      await httpRequest(app)
        .post(`/admin/billing/model-pricing/drafts/${d1.id}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          idempotencyKey: "pub-retro-1",
          requestFingerprint: fp1,
          auditReason: "Initial active tariff",
          expectedDraftVersion: 1,
          effectiveFrom: tStart,
          effectiveTo: null,
        }),
    );

    // Create replacement draft
    const d2 = successBody<ModelTariffDraftView>(
      await httpRequest(app)
        .post("/admin/billing/model-pricing/drafts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          scope: MODEL_PRICING_SCOPES.globalDefault,
          inputMicrocreditsPerMillion: "9000000",
          outputMicrocreditsPerMillion: "90000000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        }),
    );

    const retroFp = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
      assignmentId: pub1.assignment.id,
      effectiveFrom: tMid,
      effectiveTo: null,
      replacementDraftId: d2.id,
      replacementSnapshotId: null,
      auditReason: "Attempt retroactive pricing rewrite",
    });

    const retroRes = await httpRequest(app)
      .post(
        `/admin/billing/model-pricing/assignments/${pub1.assignment.id}/supersede`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "sup-retro-1",
        requestFingerprint: retroFp,
        auditReason: "Attempt retroactive pricing rewrite",
        expectedAssignmentVersion: 1,
        effectiveFrom: tMid,
        effectiveTo: null,
        replacementDraftId: d2.id,
        expectedDraftVersion: 1,
      });

    // Must be rejected with 422 MODEL_PRICING_INVALID_INTERVAL
    assert.equal(retroRes.status, 422);
    const retroProblem = problemBody(retroRes);
    assert.equal(retroProblem.status, 422);
    assert.equal(
      retroProblem.code,
      BILLING_ERROR_CODES.modelPricingInvalidInterval,
    );

    // Verify historical pricing query at tMid still resolves to original snapshot pub1.snapshot.id
    const previewAtMid = await httpRequest(app)
      .post("/admin/billing/model-pricing/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        effectiveAt: tMid,
        usage: { inputTokens: "1000", outputTokens: "1000" },
      });
    assert.equal(previewAtMid.status, 200);
    const previewData = successBody<PreviewModelPricingResponse>(previewAtMid);
    assert.equal(previewData.snapshotId, pub1.snapshot.id);
    assert.equal(
      previewData.effectiveRates.inputMicrocreditsPerMillion,
      "1000000",
    );

    // Verify original assignment was untouched
    const assignmentInDb =
      await prisma.customerModelTariffAssignment.findUniqueOrThrow({
        where: { id: pub1.assignment.id },
      });
    assert.equal(assignmentInDb.supersededByAssignmentId, null);
    assert.equal(assignmentInDb.effectiveTo, null);
  });

  it("handles concurrent publish race cleanly with one 201 and one 409 conflict", async () => {
    const createDraft = async () =>
      successBody<ModelTariffDraftView>(
        await httpRequest(app)
          .post("/admin/billing/model-pricing/drafts")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            scope: MODEL_PRICING_SCOPES.providerDefault,
            provider: "anthropic",
            inputMicrocreditsPerMillion: "2500000",
            outputMicrocreditsPerMillion: "12000000",
            reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
            cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
            cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
          }),
      );

    const [d1, d2] = await Promise.all([createDraft(), createDraft()]);
    const effectiveFrom = "2027-03-01T00:00:00.000Z";

    const buildPubPayload = (draftId: string, key: string) => ({
      idempotencyKey: key,
      requestFingerprint: computeModelPricingRequestFingerprint({
        action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
        draftId,
        expectedDraftVersion: 1,
        scope: MODEL_PRICING_SCOPES.providerDefault,
        provider: "anthropic",
        effectiveFrom,
        effectiveTo: null,
        auditReason: "Concurrent race test",
        rates: {
          inputMicrocreditsPerMillion: "2500000",
          outputMicrocreditsPerMillion: "12000000",
          reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
          cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
          cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
        },
      }),
      auditReason: "Concurrent race test",
      expectedDraftVersion: 1,
      effectiveFrom,
      effectiveTo: null,
    });

    const [res1, res2] = await Promise.all([
      httpRequest(app)
        .post(`/admin/billing/model-pricing/drafts/${d1.id}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(buildPubPayload(d1.id, "race-key-1")),
      httpRequest(app)
        .post(`/admin/billing/model-pricing/drafts/${d2.id}/publish`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(buildPubPayload(d2.id, "race-key-2")),
    ]);

    assert.deepEqual(
      [res1.status, res2.status].sort((a, b) => a - b),
      [201, 409],
    );
    assert.equal(await prisma.customerModelTariffAssignment.count(), 1);
  });

  it("enforces 23514 invalid interval constraint, fail-closed missing coverage (zero 1.8x), and scheduled assignment cancellation on supersede", async () => {
    // 1. Missing coverage fails closed with 422 MODEL_PRICING_NO_COVERAGE (never synthesizes 1.8x)
    const noCoverageRes = await httpRequest(app)
      .post("/admin/billing/model-pricing/preview")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        provider: "anthropic",
        resolvedModel: "claude-sonnet-4-6",
        usage: { inputTokens: "1000", outputTokens: "500" },
      });
    assert.equal(noCoverageRes.status, 422);
    assert.equal(
      problemBody(noCoverageRes).code,
      BILLING_ERROR_CODES.modelPricingNoCoverage,
    );

    // 2. Inverted interval on publish is rejected at HTTP validation boundary
    const draftRes = await httpRequest(app)
      .post("/admin/billing/model-pricing/drafts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        scope: MODEL_PRICING_SCOPES.globalDefault,
        inputMicrocreditsPerMillion: "1000000",
        outputMicrocreditsPerMillion: "5000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      });
    assert.equal(draftRes.status, 201);
    const draft = successBody<ModelTariffDraftView>(draftRes);

    const tFuture1 = "2027-06-01T00:00:00.000Z";
    const tFuture2 = "2027-05-01T00:00:00.000Z";
    const badIntervalRes = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${draft.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "bad-interval-1",
        requestFingerprint: "a".repeat(64),
        auditReason: "Invalid interval check",
        expectedDraftVersion: 1,
        effectiveFrom: tFuture1,
        effectiveTo: tFuture2,
      });
    assert.equal(badIntervalRes.status, 400);
    assert.equal(
      problemBody(badIntervalRes).code,
      BILLING_ERROR_CODES.validationFailed,
    );

    // 3. Publish a valid SCHEDULED assignment and verify Postgres 23514 CHECK constraint directly
    const fpSched = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.publishDraft,
      draftId: draft.id,
      expectedDraftVersion: 1,
      scope: MODEL_PRICING_SCOPES.globalDefault,
      effectiveFrom: tFuture1,
      effectiveTo: null,
      auditReason: "Scheduled window",
      rates: {
        inputMicrocreditsPerMillion: "1000000",
        outputMicrocreditsPerMillion: "5000000",
        reasoningPolicy: TOKEN_BUCKET_POLICIES.includedInOutput,
        cachedInputPolicy: TOKEN_BUCKET_POLICIES.unsupported,
        cacheWritePolicy: TOKEN_BUCKET_POLICIES.unsupported,
      },
    });
    const pubSchedRes = await httpRequest(app)
      .post(`/admin/billing/model-pricing/drafts/${draft.id}/publish`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "sched-pub-1",
        requestFingerprint: fpSched,
        auditReason: "Scheduled window",
        expectedDraftVersion: 1,
        effectiveFrom: tFuture1,
        effectiveTo: null,
      });
    assert.equal(pubSchedRes.status, 201);
    const pubSched = successBody<PublishModelTariffDraftResponse>(pubSchedRes);
    assert.equal(
      pubSched.assignment.status,
      PRICING_ASSIGNMENT_STATUSES.scheduled,
    );

    await assert.rejects(async () => {
      try {
        await prisma.customerModelTariffAssignment.create({
          data: {
            tariffSnapshotId: pubSched.snapshot.id,
            scope: MODEL_PRICING_SCOPES.globalDefault,
            normalizedScopeKey: "GLOBAL_DEFAULT",
            effectiveFrom: new Date(tFuture1),
            effectiveTo: new Date(tFuture2),
            createdBy: "user-3",
          },
        });
      } catch (err) {
        mapPrismaModelPricingPersistenceError(err);
      }
    }, ModelPricingInvalidIntervalError);

    // 4. Supersede a SCHEDULED assignment with an earlier effectiveFrom cancels it cleanly via cancelledAt
    const fpSupSched = computeModelPricingRequestFingerprint({
      action: MODEL_PRICING_FINGERPRINT_ACTIONS.supersedeAssignment,
      assignmentId: pubSched.assignment.id,
      effectiveFrom: tFuture2,
      effectiveTo: null,
      replacementDraftId: null,
      replacementSnapshotId: pubSched.snapshot.id,
      auditReason: "Bring scheduled window forward",
    });
    const supSchedRes = await httpRequest(app)
      .post(
        `/admin/billing/model-pricing/assignments/${pubSched.assignment.id}/supersede`,
      )
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "sched-sup-1",
        requestFingerprint: fpSupSched,
        auditReason: "Bring scheduled window forward",
        expectedAssignmentVersion: 1,
        effectiveFrom: tFuture2,
        effectiveTo: null,
        replacementSnapshotId: pubSched.snapshot.id,
      });
    assert.equal(supSchedRes.status, 201);
    const supSched =
      successBody<SupersedeModelTariffAssignmentResponse>(supSchedRes);
    assert.ok(supSched.supersededAssignment.cancelledAt);
    assert.equal(
      supSched.supersededAssignment.status,
      PRICING_ASSIGNMENT_STATUSES.superseded,
    );
    assert.equal(supSched.replacementAssignment.effectiveFrom, tFuture2);
    assert.equal(supSched.replacementSnapshot.id, pubSched.snapshot.id);
  });
});
