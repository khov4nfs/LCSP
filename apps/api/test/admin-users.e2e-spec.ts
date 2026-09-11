import {
  ADMIN_ERROR_CODES,
  ADMIN_ACCOUNT_ERRORS,
  USER_ACCESS_STATUSES,
  AUTH_AUDIT_EVENT_TYPES,
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

import { ConfigModule } from "@nestjs/config";
import { AuthWorkspaceModule } from "../src/modules/auth-workspace/auth-workspace.module.js";
import { RbacModule } from "../src/platform/rbac/rbac.module.js";
import { MailModule } from "../src/platform/mail/mail.module.js";
import { ProblemExceptionFilter } from "../src/platform/problems/problem-exception.filter.js";
import { ProblemStatusInterceptor } from "../src/platform/problems/problem-status.interceptor.js";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
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
      // Test the actual auth module and guard without unrelated repository CLI providers.
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MailModule,
        AuthWorkspaceModule,
        RbacModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ProblemStatusInterceptor },
      ],
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

    it("does not expose an existing-user role endpoint, even to Admin", async () => {
      for (const token of [adminSessionToken, customerSessionToken]) {
        const res = await httpRequest(app)
          .post(`/admin/users/${targetCustomer.id}/role`)
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", crypto.randomUUID())
          .send({ role: AUTH_USER_ROLES.admin, expectedVersion: 0 });
        assert.equal(res.status, 404);
      }
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: targetCustomer.id },
      });
      assert.equal(current.role, AUTH_USER_ROLES.customer);
      assert.equal(current.accessVersion, 0);
      assert.equal(await prisma.adminAccountCommandReceipt.count(), 0);
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

  describe("Account Suspension & Session Invalidation", () => {
    it("blocks new password sessions while suspended and permits new sign-in after restore", async () => {
      const key = crypto.randomUUID();
      const suspended = await httpRequest(app)
        .post(`/admin/users/${targetCustomer.id}/suspend`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Idempotency-Key", key)
        .send({ expectedVersion: 0 });
      assert.equal(suspended.status, 200);
      const denied = await httpRequest(app)
        .post("/auth/sign-in")
        .send({ email: targetCustomer.email, password: "Password123!" });
      assert.equal(denied.status, 403);
      assert.equal(problemCode(denied), AUTH_ERROR_CODES.accountSuspended);
      const restored = await httpRequest(app)
        .post(`/admin/users/${targetCustomer.id}/restore`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Idempotency-Key", crypto.randomUUID())
        .send({ expectedVersion: 1 });
      assert.equal(restored.status, 200);
      const signedIn = await httpRequest(app)
        .post("/auth/sign-in")
        .send({ email: targetCustomer.email, password: "Password123!" });
      assert.equal(signedIn.status, 200);
    });

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
        .set("Idempotency-Key", crypto.randomUUID())
        .send({ reason: "Security violation", expectedVersion: 0 })
        .set("Accept", "application/json");

      assert.equal(suspendRes.status, 200);
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

      // 5. Product suspension is durable and does not repurpose failed-login lockout
      const dbUser = await prisma.user.findUnique({
        where: { id: targetCustomer.id },
      });
      assert.equal(dbUser?.accessStatus, USER_ACCESS_STATUSES.suspended);
      assert.equal(dbUser?.lockUntil, null);

      // 6. Verify audit event
      const audit = await prisma.auditEvent.findFirst({
        where: {
          resourceId: targetCustomer.id,
          eventType: AUTH_AUDIT_EVENT_TYPES.authAdminUserSuspended,
        },
      });
      assert.ok(audit, "Suspension audit event must be logged");
    });

    it("prevents self-suspension by the Admin", async () => {
      const res = await httpRequest(app)
        .post(`/admin/users/${adminUser.id}/suspend`)
        .set("Authorization", `Bearer ${adminSessionToken}`)
        .set("Idempotency-Key", crypto.randomUUID())
        .send({ reason: "Accidental self-suspend", expectedVersion: 0 })
        .set("Accept", "application/json");

      assert.equal(res.status, 409);
      assert.equal(problemCode(res), ADMIN_ACCOUNT_ERRORS.selfSuspend);
    });
  });
});
