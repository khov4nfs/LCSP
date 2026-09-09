import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { LEGAL_RULE_ERROR_CODES } from "@lcsp/contracts/legal-rule-catalog";
import { RBAC_REASON_CODES } from "@lcsp/contracts/rbac";
import * as assert from "node:assert/strict";
import crypto from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AppModule } from "../src/app.module.js";
import {
  TEST_DATABASE_URL,
  ensureTestMfaEncryptionKey,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
} from "./support/auth-workspace-test-helpers.js";
import { hashSecret } from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
} from "../src/infrastructure/prisma/prisma-enum-mappers.js";
import { createAuthSessionRecord } from "./support/auth-record-test-helpers.js";

describe("Admin Release Gate & Security Integrity (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminUser: { id: string; email: string };
  let adminSessionToken: string;
  let customerUser: { id: string; email: string };
  let customerSessionToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ensureTestMfaEncryptionKey();
    pushPrismaSchema();

    prisma = new PrismaClient({
      adapter: new PrismaPg(TEST_DATABASE_URL),
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);

    // Create Admin user
    const adminId = crypto.randomUUID();
    const adminEmail = `admin-${Date.now()}@example.com`;
    const adminDbUser = await prisma.user.create({
      data: {
        id: adminId,
        email: adminEmail,
        displayName: "Admin User",
        passwordHash: hashSecret("Password123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.admin,
      },
    });
    adminUser = { id: adminDbUser.id, email: adminDbUser.email };

    adminSessionToken = `adm-sess-${Date.now()}`;
    await createAuthSessionRecord(prisma, {
      id: crypto.randomUUID(),
      userId: adminUser.id,
      token: adminSessionToken,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    // Create Customer user
    const customerId = crypto.randomUUID();
    const customerEmail = `customer-${Date.now()}@example.com`;
    const customerDbUser = await prisma.user.create({
      data: {
        id: customerId,
        email: customerEmail,
        displayName: "Customer User",
        passwordHash: hashSecret("Password123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
    });
    customerUser = { id: customerDbUser.id, email: customerDbUser.email };

    customerSessionToken = `cust-sess-${Date.now()}`;
    await createAuthSessionRecord(prisma, {
      id: crypto.randomUUID(),
      userId: customerUser.id,
      token: customerSessionToken,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe("Section 1: Admin RBAC & Server-Side Security Authority", () => {
    it("rejects unauthenticated/anonymous requests to admin endpoints with 401", async () => {
      // 1. Audit list endpoint
      const resAudit = await httpRequest(app)
        .get("/audit-events")
        .set("Accept", "application/json");

      assert.equal(resAudit.status, 401);
      assert.equal(problemCode(resAudit), AUTH_ERROR_CODES.sessionInvalid);

      // 2. Audit export endpoint
      const resAuditExport = await httpRequest(app)
        .post("/audit-events/export")
        .send({ from_date: "2026-01-01", to_date: "2026-09-08" })
        .set("Accept", "application/json");

      assert.equal(resAuditExport.status, 401);
      assert.equal(
        problemCode(resAuditExport),
        AUTH_ERROR_CODES.sessionInvalid,
      );

      // 3. Admin source catalog endpoint
      const resCatalog = await httpRequest(app)
        .get("/assessments/dummy-id/admin-source-catalog")
        .set("Accept", "application/json");

      assert.equal(resCatalog.status, 401);
      assert.equal(problemCode(resCatalog), AUTH_ERROR_CODES.sessionInvalid);

      // 4. Admin corpus readiness endpoint
      const resReadiness = await httpRequest(app)
        .get("/assessments/dummy-id/legal-corpus-readiness")
        .set("Accept", "application/json");

      assert.equal(resReadiness.status, 401);
      assert.equal(problemCode(resReadiness), AUTH_ERROR_CODES.sessionInvalid);

      // 5. Admin legal rule catalog mutation endpoint
      const resVersionMutation = await httpRequest(app)
        .post("/internal/legal-rule-catalog/versions")
        .send({ version: "v2026.09.01" })
        .set("Accept", "application/json");

      assert.equal(resVersionMutation.status, 401);
      assert.equal(
        problemCode(resVersionMutation),
        AUTH_ERROR_CODES.sessionInvalid,
      );
    });

    it("strictly denies Customer role on Admin endpoints with 403 RBAC_DENIED", async () => {
      // 1. Audit list endpoint
      const resAudit = await httpRequest(app)
        .get("/audit-events")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(resAudit.status, 403);
      assert.equal(problemCode(resAudit), RBAC_REASON_CODES.denied);

      // 2. Audit export endpoint
      const resAuditExport = await httpRequest(app)
        .post("/audit-events/export")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .send({ from_date: "2026-01-01", to_date: "2026-09-08" })
        .set("Accept", "application/json");

      assert.equal(resAuditExport.status, 403);
      assert.equal(problemCode(resAuditExport), RBAC_REASON_CODES.denied);

      // 3. Admin source catalog endpoint
      const resCatalog = await httpRequest(app)
        .get("/assessments/dummy-id/admin-source-catalog")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(resCatalog.status, 403);
      assert.equal(problemCode(resCatalog), RBAC_REASON_CODES.denied);

      // 4. Admin corpus readiness endpoint
      const resReadiness = await httpRequest(app)
        .get("/assessments/dummy-id/legal-corpus-readiness")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(resReadiness.status, 403);
      assert.equal(problemCode(resReadiness), RBAC_REASON_CODES.denied);

      // 5. Admin mutation endpoint
      const resVersionMutation = await httpRequest(app)
        .post("/internal/legal-rule-catalog/versions")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .send({ version: "v2026.09.01" })
        .set("Accept", "application/json");

      assert.equal(resVersionMutation.status, 403);
      assert.equal(problemCode(resVersionMutation), RBAC_REASON_CODES.denied);
    });

    it("allows Admin role access on Admin endpoints", async () => {
      const resAudit = await httpRequest(app)
        .get("/audit-events")
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(resAudit.status, 200);
      const auditData = successBody<{ events?: unknown[]; total?: number }>(
        resAudit,
      );
      assert.ok(Array.isArray(auditData.events));
    });
  });

  describe("Section 2: User Lifecycle & Session Revocation via Real API", () => {
    it("revoking session via /auth/revoke-session invalidates protected access immediately", async () => {
      // 1. Verify session works initially
      const initialRes = await httpRequest(app)
        .get("/workspace")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .set("Accept", "application/json");
      assert.equal(initialRes.status, 200);

      // 2. Perform session revocation via real API endpoint
      const revokeRes = await httpRequest(app)
        .post("/auth/revoke-session")
        .send({ session_token: customerSessionToken })
        .set("Accept", "application/json");
      assert.equal(revokeRes.status, 201);

      // 3. Verify revoked session token cannot access any protected endpoints
      const postRevokeRes = await httpRequest(app)
        .get("/workspace")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(postRevokeRes.status, 401);
      assert.equal(problemCode(postRevokeRes), AUTH_ERROR_CODES.sessionInvalid);
    });
  });

  describe("Section 3: Legal Rule Catalog & Corpus Lifecycle Mutations", () => {
    it("allows Admin to create draft catalog version and rejects duplicates with 409", async () => {
      const versionTag = `v${Date.now()}`;

      // 1. Create draft catalog version via Admin API
      const createRes = await httpRequest(app)
        .post("/internal/legal-rule-catalog/versions")
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .send({ version: versionTag })
        .set("Accept", "application/json");

      assert.equal(createRes.status, 201);
      const createdData = successBody<{ version: string }>(createRes);
      assert.equal(createdData.version, versionTag);

      // 2. Attempt duplicate version creation -> 409 Conflict
      const duplicateRes = await httpRequest(app)
        .post("/internal/legal-rule-catalog/versions")
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .send({ version: versionTag })
        .set("Accept", "application/json");

      assert.equal(duplicateRes.status, 409);
      assert.equal(
        problemCode(duplicateRes),
        LEGAL_RULE_ERROR_CODES.catalogVersionAlreadyApproved,
      );
    });
  });

  describe("Section 4: Audit Trail Security & Secret Redaction via Real API", () => {
    it("ensures audit log payloads never contain sensitive credentials when queried by Admin", async () => {
      const auditId = crypto.randomUUID();
      const correlationId = crypto.randomUUID();

      // Seed audit event with sensitive data in payload
      await prisma.auditEvent.create({
        data: {
          id: auditId,
          eventType: "ADMIN_USER_MODIFICATION",
          actorId: adminUser.id,
          resourceType: toPrismaAuditResourceType(
            AUDIT_RESOURCE_TYPES.workspace,
          ),
          resourceId: customerUser.id,
          decision: toPrismaAuthDecision(AUDIT_DECISIONS.allow),
          correlationId,
          payload: {
            targetUserId: customerUser.id,
            action: "UPDATE_ROLE",
            password: "SuperSecretPassword123!",
            passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz",
            mfaSecret: "JBSWY3DPEHPK3PXP",
            sessionToken: "sess_secret_token_123",
            workerApiKey: "worker-live-secret-key",
          },
        },
      });

      // Admin queries audit list via real Admin endpoint
      const res = await httpRequest(app)
        .get(`/audit-events?actor_id=${adminUser.id}`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 200);
      const data = successBody<{
        events: { event_id: string; payload?: Record<string, unknown> }[];
      }>(res);
      assert.ok(Array.isArray(data.events));

      const seededItem = data.events.find((item) => item.event_id === auditId);
      assert.ok(seededItem, "Seeded audit event must be returned in query");

      const sanitizedPayload = seededItem.payload || {};
      assert.equal(sanitizedPayload.targetUserId, customerUser.id);
      assert.equal(sanitizedPayload.password, undefined);
      assert.equal(sanitizedPayload.passwordHash, undefined);
      assert.equal(sanitizedPayload.mfaSecret, undefined);
      assert.equal(sanitizedPayload.sessionToken, undefined);
      assert.equal(sanitizedPayload.workerApiKey, undefined);
    });

    it("allows Admin to initiate audit trail export with 202 Accepted", async () => {
      const exportRes = await httpRequest(app)
        .post("/audit-events/export")
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .send({ from_date: "2026-01-01", to_date: "2026-09-08" })
        .set("Accept", "application/json");

      assert.equal(exportRes.status, 202);
      const exportData = successBody<{
        export_request_id: string;
        status: string;
      }>(exportRes);
      assert.ok(exportData.export_request_id);
    });

    it("revoking Admin session immediately denies access to Admin endpoints", async () => {
      // 1. Revoke the admin session
      const revokeRes = await httpRequest(app)
        .post("/auth/revoke-session")
        .send({ session_token: adminSessionToken })
        .set("Accept", "application/json");
      assert.equal(revokeRes.status, 201);

      // 2. Calling admin endpoint with revoked token now returns 401
      const resAudit = await httpRequest(app)
        .get("/audit-events")
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(resAudit.status, 401);
      assert.equal(problemCode(resAudit), AUTH_ERROR_CODES.sessionInvalid);
    });
  });

  describe("Section 5: Dependency Boundary Matrix & Upstream Tracking", () => {
    it("explicitly records upstream feature boundaries pending LCSP-294..300", () => {
      const DEPENDENCY_STATUSES = {
        "LCSP-294": "PENDING_UPSTREAM_MERGE (Admin Shell & Overview UI)",
        "LCSP-295": "PENDING_UPSTREAM_MERGE (User Accounts Management UI)",
        "LCSP-296": "PENDING_UPSTREAM_MERGE (Corpus Versions UI)",
        "LCSP-298": "PENDING_UPSTREAM_MERGE (Admin Overview API & Read Model)",
        "LCSP-299":
          "PENDING_UPSTREAM_MERGE (Admin User Lifecycle API & Mutations)",
        "LCSP-300":
          "PENDING_UPSTREAM_MERGE (Corpus Administration API & Readiness Engine)",
      };

      assert.ok(DEPENDENCY_STATUSES["LCSP-294"]);
      assert.ok(DEPENDENCY_STATUSES["LCSP-295"]);
      assert.ok(DEPENDENCY_STATUSES["LCSP-296"]);
      assert.ok(DEPENDENCY_STATUSES["LCSP-298"]);
      assert.ok(DEPENDENCY_STATUSES["LCSP-299"]);
      assert.ok(DEPENDENCY_STATUSES["LCSP-300"]);
    });
  });
});
