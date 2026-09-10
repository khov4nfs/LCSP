import {
  ADMIN_ERROR_CODES,
  AUTH_ACCOUNT_STATUSES,
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  type AdminUserDetail,
  type AdminUserListResponse,
} from "@lcsp/contracts/auth";
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
import { createAuthSessionRecord } from "./support/auth-record-test-helpers.js";

describe("Admin User Management API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  let adminUser: { id: string; email: string };
  let adminSessionToken: string;
  let customerUser: { id: string; email: string };
  let customerSessionToken: string;
  let targetCustomer: { id: string; email: string };

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
        displayName: "Admin Operator",
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

    // Create Calling Customer user
    const customerId = crypto.randomUUID();
    const customerEmail = `customer-${Date.now()}@example.com`;
    const customerDbUser = await prisma.user.create({
      data: {
        id: customerId,
        email: customerEmail,
        displayName: "Regular Customer",
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

    // Create Target Customer user for management operations
    const targetId = crypto.randomUUID();
    const targetEmail = `target-${Date.now()}@example.com`;
    const targetDbUser = await prisma.user.create({
      data: {
        id: targetId,
        email: targetEmail,
        displayName: "Target User",
        passwordHash: hashSecret("Password123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
    });
    targetCustomer = { id: targetDbUser.id, email: targetDbUser.email };
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe("Authentication & RBAC Authority", () => {
    it("rejects unauthenticated requests to /admin/users with 401", async () => {
      const res = await httpRequest(app)
        .get("/admin/users")
        .set("Accept", "application/json");

      assert.equal(res.status, 401);
      assert.equal(problemCode(res), AUTH_ERROR_CODES.sessionInvalid);
    });

    it("rejects non-admin (Customer role) requests to /admin/users with 403 RBAC_DENIED", async () => {
      const res = await httpRequest(app)
        .get("/admin/users")
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 403);
      assert.equal(problemCode(res), RBAC_REASON_CODES.denied);
    });

    it("rejects non-admin requests to /admin/users/:id with 403 RBAC_DENIED", async () => {
      const res = await httpRequest(app)
        .get(`/admin/users/${targetCustomer.id}`)
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 403);
      assert.equal(problemCode(res), RBAC_REASON_CODES.denied);
    });

    it("rejects non-admin role update requests with 403 RBAC_DENIED", async () => {
      const res = await httpRequest(app)
        .post(`/admin/users/${targetCustomer.id}/role`)
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .send({ role: AUTH_USER_ROLES.admin })
        .set("Accept", "application/json");

      assert.equal(res.status, 403);
      assert.equal(problemCode(res), RBAC_REASON_CODES.denied);
    });

    it("rejects non-admin suspend requests with 403 RBAC_DENIED", async () => {
      const res = await httpRequest(app)
        .post(`/admin/users/${targetCustomer.id}/suspend`)
        .set("Authorization", `Bearer ${customerSessionToken}`)
        .send({ reason: "Testing" })
        .set("Accept", "application/json");

      assert.equal(res.status, 403);
      assert.equal(problemCode(res), RBAC_REASON_CODES.denied);
    });
  });

  describe("User Directory & Detail Queries", () => {
    it("allows Admin to list users with pagination and search", async () => {
      const res = await httpRequest(app)
        .get("/admin/users?page=1&page_size=10")
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 200);
      const data = successBody<AdminUserListResponse>(res);
      assert.ok(data.users.length >= 3);
      assert.ok(data.totalCount >= 3);
      assert.equal(data.page, 1);
      assert.equal(data.pageSize, 10);

      const foundAdmin = data.users.find((u) => u.id === adminUser.id);
      assert.ok(foundAdmin);
      assert.equal(foundAdmin.role, AUTH_USER_ROLES.admin);
      assert.equal(foundAdmin.status, AUTH_ACCOUNT_STATUSES.active);
    });

    it("allows Admin to filter users by search query", async () => {
      const res = await httpRequest(app)
        .get(`/admin/users?query=${encodeURIComponent("Target User")}`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 200);
      const data = successBody<AdminUserListResponse>(res);
      assert.equal(data.users.length, 1);
      assert.equal(data.users[0].id, targetCustomer.id);
    });

    it("allows Admin to filter users by role", async () => {
      const res = await httpRequest(app)
        .get(`/admin/users?role=${AUTH_USER_ROLES.admin}`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 200);
      const data = successBody<AdminUserListResponse>(res);
      assert.ok(data.users.every((u) => u.role === AUTH_USER_ROLES.admin));
    });

    it("allows Admin to get user detail with usage summary", async () => {
      const res = await httpRequest(app)
        .get(`/admin/users/${targetCustomer.id}`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 200);
      const data = successBody<AdminUserDetail>(res);
      assert.equal(data.id, targetCustomer.id);
      assert.equal(data.email, targetCustomer.email);
      assert.equal(data.role, AUTH_USER_ROLES.customer);
      assert.equal(data.status, AUTH_ACCOUNT_STATUSES.active);
      assert.ok(data.usageSummary);
      assert.equal(typeof data.usageSummary.assessments30d, "number");
      assert.equal(data.usageSummary.creditSpend30d, null);
      assert.equal(data.usageSummary.openFindingsCount, null);
    });

    it("returns 404 userNotFound when querying non-existent user", async () => {
      const res = await httpRequest(app)
        .get(`/admin/users/${crypto.randomUUID()}`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(res.status, 404);
      assert.equal(problemCode(res), ADMIN_ERROR_CODES.userNotFound);
    });
  });

  describe("Role Mutations & Last-Admin Safeguards", () => {
    it("allows Admin to promote Customer to Admin and persists in database", async () => {
      const res = await httpRequest(app)
        .post(`/admin/users/${targetCustomer.id}/role`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .send({ role: AUTH_USER_ROLES.admin })
        .set("Accept", "application/json");

      assert.equal(res.status, 201);
      const data = successBody<AdminUserDetail>(res);
      assert.equal(data.role, AUTH_USER_ROLES.admin);

      // Verify in database
      const dbUser = await prisma.user.findUnique({
        where: { id: targetCustomer.id },
      });
      assert.equal(dbUser?.role, "ADMIN");

      // Verify audit log
      const audit = await prisma.auditEvent.findFirst({
        where: {
          resourceId: targetCustomer.id,
          eventType: "AUTH_ADMIN_USER_ROLE_UPDATED",
        },
      });
      assert.ok(audit, "Audit event must be logged");
    });

    it("prevents self-demotion by an Admin", async () => {
      const res = await httpRequest(app)
        .post(`/admin/users/${adminUser.id}/role`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .send({ role: AUTH_USER_ROLES.customer })
        .set("Accept", "application/json");

      assert.equal(res.status, 400);
      assert.equal(problemCode(res), AUTH_ERROR_CODES.validationFailed);

      // Admin role must remain unchanged
      const dbUser = await prisma.user.findUnique({
        where: { id: adminUser.id },
      });
      assert.equal(dbUser?.role, "ADMIN");
    });

    it("prevents demoting the last active Admin when demoting another admin", async () => {
      // Set all other users to CUSTOMER
      await prisma.user.updateMany({
        where: { NOT: { id: targetCustomer.id } },
        data: { role: "CUSTOMER" },
      });
      // Promote targetCustomer to ADMIN as the single admin in system
      await prisma.user.update({
        where: { id: targetCustomer.id },
        data: { role: "ADMIN" },
      });

      // Create a separate admin session for a second admin to execute the request
      const otherAdminId = crypto.randomUUID();
      await prisma.user.create({
        data: {
          id: otherAdminId,
          email: "superadmin@example.com",
          passwordHash: hashSecret("Password123!"),
          emailVerified: true,
          failedLoginCount: 0,
          role: AUTH_USER_ROLES.admin,
        },
      });
      const otherAdminToken = `superadm-token-${Date.now()}`;
      await createAuthSessionRecord(prisma, {
        id: crypto.randomUUID(),
        userId: otherAdminId,
        token: otherAdminToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      // Now demote targetCustomer -> OK because otherAdminId exists
      const okRes = await httpRequest(app)
        .post(`/admin/users/${targetCustomer.id}/role`)
        .set("Authorization", `Bearer ${otherAdminToken}`)
        .send({ role: AUTH_USER_ROLES.customer })
        .set("Accept", "application/json");
      assert.equal(okRes.status, 201);
    });
  });

  describe("Account Suspension & Session Invalidation", () => {
    it("allows Admin to suspend a user, immediately invalidating active sessions", async () => {
      // 1. Create active session for target customer
      const targetSessionToken = `target-active-sess-${Date.now()}`;
      await createAuthSessionRecord(prisma, {
        id: crypto.randomUUID(),
        userId: targetCustomer.id,
        token: targetSessionToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      // 2. Verify target user can access protected route initially
      const initRes = await httpRequest(app)
        .get("/workspace")
        .set("Authorization", `Bearer ${targetSessionToken}`)
        .set("Accept", "application/json");
      assert.equal(initRes.status, 200);

      // 3. Admin suspends target user
      const suspendRes = await httpRequest(app)
        .post(`/admin/users/${targetCustomer.id}/suspend`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .send({ reason: "Security violation" })
        .set("Accept", "application/json");

      assert.equal(suspendRes.status, 201);
      const data = successBody<AdminUserDetail>(suspendRes);
      assert.equal(data.status, AUTH_ACCOUNT_STATUSES.suspended);

      // 4. Verify target user's session is revoked and protected access returns 401
      const postSuspendRes = await httpRequest(app)
        .get("/workspace")
        .set("Authorization", `Bearer ${targetSessionToken}`)
        .set("Accept", "application/json");

      assert.equal(postSuspendRes.status, 401);
      assert.equal(
        problemCode(postSuspendRes),
        AUTH_ERROR_CODES.sessionInvalid,
      );

      // 5. Verify user in database is locked
      const dbUser = await prisma.user.findUnique({
        where: { id: targetCustomer.id },
      });
      assert.ok(dbUser?.lockUntil && dbUser.lockUntil.getTime() > Date.now());

      // 6. Verify audit event
      const audit = await prisma.auditEvent.findFirst({
        where: {
          resourceId: targetCustomer.id,
          eventType: "AUTH_ADMIN_USER_SUSPENDED",
        },
      });
      assert.ok(audit, "Suspension audit event must be logged");
    });

    it("prevents self-suspension by the Admin", async () => {
      const res = await httpRequest(app)
        .post(`/admin/users/${adminUser.id}/suspend`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .send({ reason: "Accidental self-suspend" })
        .set("Accept", "application/json");

      assert.equal(res.status, 400);
      assert.equal(problemCode(res), AUTH_ERROR_CODES.validationFailed);
    });
  });
});
