import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import {
  Controller,
  Get,
  UseGuards,
  type INestApplication,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  ACCOUNT_INVITATION_STATUSES,
  ADMIN_ACCOUNT_ERRORS as E,
  ADMIN_ACCOUNT_OPERATIONS,
  AUTH_ACCOUNT_STATUSES,
  AUTH_AUDIT_EVENT_TYPES,
  AUTH_USER_ROLES,
  USER_ACCESS_STATUSES,
} from "@lcsp/contracts/auth";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../src/platform/audit/audit-writer.service.js";
import { MailService } from "../src/platform/mail/mail.service.js";
import { ProblemExceptionFilter } from "../src/platform/problems/problem-exception.filter.js";
import { RequireSession } from "../src/platform/rbac/decorators/require-session.decorator.js";
import { RbacGuard } from "../src/platform/rbac/rbac.guard.js";
import { RbacContextLoader } from "../src/platform/rbac/rbac-context.loader.js";
import { RbacPreflightService } from "../src/platform/rbac/rbac-preflight.service.js";
import { RBAC_DECISIONS } from "@lcsp/contracts/rbac";
import { AdminUsersController } from "../src/modules/auth-workspace/presentation/http/admin-users.controller.js";
import { AccountInvitationsController } from "../src/modules/auth-workspace/presentation/http/account-invitations.controller.js";
import { AdminAccountReadService } from "../src/modules/auth-workspace/application/services/admin/admin-account-read.service.js";
import { AdminAccountCommandService } from "../src/modules/auth-workspace/application/services/admin/admin-account-command.service.js";
import { AdminAccountInvitationService } from "../src/modules/auth-workspace/application/services/admin/admin-account-invitation.service.js";
import { AuthAuditService } from "../src/modules/auth-workspace/application/services/auth-workspace/auth-audit.service.js";
import {
  PrismaAuthorizationDecisionRepository,
  PrismaMfaEnrollmentRepository,
  PrismaSessionRepository,
  PrismaUserRepository,
} from "../src/modules/auth-workspace/infrastructure/persistence/prisma-auth-workspace.repositories.js";
import {
  hashSecret,
  fingerprintToken,
} from "../src/modules/auth-workspace/infrastructure/security/security.utils.js";
import {
  AUTH_RECORD_TYPES,
  authRecordLookupKey,
} from "../src/modules/auth-workspace/infrastructure/persistence/auth-record.persistence.js";
import { Session } from "../src/modules/auth-workspace/domain/entities/session.entity.js";
import type {
  AdminUserDetail,
  AdminAccountOperation,
  AdminUserListResponse,
} from "@lcsp/contracts/auth";
import { httpRequest, successBody } from "./support/http.js";
const databaseUrl = process.env.LCSP299_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const PASSWORD = "Only-a-disposable-test-password-299!";
@Controller("lcsp299-test/protected")
class ProtectedController {
  @Get()
  @UseGuards(RbacGuard)
  @RequireSession()
  get() {
    return { ok: true };
  }
}
type Actor = {
  id: string;
  token: string;
  email: string;
};
const code = (body: unknown) =>
  (
    body as {
      problem?: {
        code?: string;
      };
    }
  ).problem?.code;
integration(
  "LCSP-299: real PostgreSQL, production services and RbacGuard",
  () => {
    let prisma: PrismaClient;
    let app: INestApplication;
    let admin: Actor;
    let target: Actor;
    let mailFails = false;
    let mailConfigured = true;
    const deliveries: Array<{
      text: string;
      to: string;
    }> = [];
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/lcsp_299_test" ||
        url.port !== "55439"
      ) {
        throw new Error(
          "Refusing non-disposable database; require localhost:55439/lcsp_299_test",
        );
      }
      prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl!) });
      const module = await Test.createTestingModule({
        controllers: [
          AdminUsersController,
          AccountInvitationsController,
          ProtectedController,
        ],
        providers: [
          { provide: PrismaService, useValue: prisma },
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) =>
                (
                  ({
                    ADMIN_INVITATION_ENCRYPTION_KEY:
                      "lcsp299-disposable-invitation-key-at-least-32-bytes",
                    ADMIN_INVITATION_WEB_ORIGIN: "http://localhost:3000",
                  }) as Record<string, string>
                )[key],
            },
          },
          {
            provide: MailService,
            useValue: {
              isConfigured: () => mailConfigured,
              send: (input: { text: string; to: string }) => {
                deliveries.push(input);
                if (mailFails) throw new Error("simulated SMTP failure");
                return Promise.resolve({ messageId: "test-message" });
              },
            },
          },
          AdminAccountReadService,
          AdminAccountCommandService,
          AdminAccountInvitationService,
          AuthAuditService,
          AuditWriterService,
          ProblemExceptionFilter,
          RbacGuard,
          RbacContextLoader,
          RbacPreflightService,
          PrismaAuthorizationDecisionRepository,
          PrismaMfaEnrollmentRepository,
          PrismaSessionRepository,
          PrismaUserRepository,
        ],
      }).compile();
      app = module.createNestApplication();
      app.useGlobalFilters(module.get(ProblemExceptionFilter));
      await app.init();
    }, 30000);
    async function actor(
      role: (typeof AUTH_USER_ROLES)[keyof typeof AUTH_USER_ROLES],
      name: string,
    ): Promise<Actor> {
      const id = randomUUID();
      const token = randomUUID();
      const email = `${id}@example.com`;
      await prisma.user.create({
        data: {
          id,
          email,
          displayName: name,
          passwordHash: hashSecret(PASSWORD),
          emailVerified: true,
          failedLoginCount: 0,
          role,
        },
      });
      await prisma.authRecord.create({
        data: {
          id: randomUUID(),
          userId: id,
          type: AUTH_RECORD_TYPES.session,
          lookupKey: authRecordLookupKey(
            AUTH_RECORD_TYPES.session,
            fingerprintToken(token),
          ),
          secretHash: hashSecret(token),
          expiresAt: new Date(Date.now() + 3600000),
          metadata: { accessVersion: 0 },
        },
      });
      return { id, email, token };
    }
    beforeEach(async () => {
      jest.restoreAllMocks();
      await prisma.adminAccountCommandReceipt.deleteMany();
      await prisma.accountInvitation.deleteMany();
      await prisma.auditEvent.deleteMany();
      await prisma.authRecord.deleteMany();
      await prisma.assessment.deleteMany();
      await prisma.user.deleteMany();
      mailFails = false;
      mailConfigured = true;
      deliveries.length = 0;
      admin = await actor(AUTH_USER_ROLES.admin, "Admin");
      target = await actor(AUTH_USER_ROLES.customer, "Target");
    });
    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
    });
    function mutate(
      as: Actor,
      id: string,
      operation: string,
      body: object,
      key: string = randomUUID(),
    ) {
      return httpRequest(app)
        .post(`/admin/users/${id}/${operation}`)
        .set("Authorization", `Bearer ${as.token}`)
        .set("Idempotency-Key", key)
        .send(body);
    }
    function invite(
      email: string,
      key: string = randomUUID(),
      role = AUTH_USER_ROLES.customer as (typeof AUTH_USER_ROLES)[keyof typeof AUTH_USER_ROLES],
    ) {
      return httpRequest(app)
        .post("/admin/users")
        .set("Authorization", `Bearer ${admin.token}`)
        .set("Idempotency-Key", key)
        .send({ email, displayName: "Invited Person", role });
    }
    function get(path: string, as = admin) {
      return httpRequest(app)
        .get(path)
        .set("Authorization", `Bearer ${as.token}`);
    }
    function tokenFromMail(index = deliveries.length - 1): string {
      const token = deliveries[index]?.text.match(
        /#invitation=([a-f0-9]{64})/,
      )?.[1];
      if (!token)
        throw new Error("Expected actual one-time token in fake mail");
      return token;
    }
    function accept(token: string) {
      return httpRequest(app)
        .post("/auth/invitations/accept")
        .send({ token, password: PASSWORD });
    }
    it("denies anonymous/non-admin list, detail and every Admin write", async () => {
      expect((await httpRequest(app).get("/admin/users")).status).toBe(401);
      for (const path of ["/admin/users", `/admin/users/${admin.id}`])
        expect((await get(path, target)).status).toBe(403);
      for (const operation of ["suspend", "restore"]) {
        expect(
          (
            await mutate(target, admin.id, operation, {
              expectedVersion: 0,
            })
          ).status,
        ).toBe(403);
        expect(
          (
            await httpRequest(app)
              .post(`/admin/users/${target.id}/${operation}`)
              .send({ expectedVersion: 0 })
          ).status,
        ).toBe(401);
      }
      expect(
        (
          await httpRequest(app)
            .post("/admin/users")
            .set("Authorization", `Bearer ${target.token}`)
            .send({
              email: "new@example.com",
              displayName: "New",
              role: AUTH_USER_ROLES.admin,
            })
        ).status,
      ).toBe(403);
    });
    it("does not label lockout or unverified users as Suspended/Invited", async () => {
      await prisma.user.update({
        where: { id: target.id },
        data: { emailVerified: false, lockUntil: new Date(Date.now() + 60000) },
      });
      expect(
        successBody<AdminUserDetail>(await get(`/admin/users/${target.id}`))
          .status,
      ).toBe(AUTH_ACCOUNT_STATUSES.active);
      expect(
        successBody<AdminUserListResponse>(
          await get("/admin/users?status=INVITED"),
        ).totalCount,
      ).toBe(0);
    });
    it("suspends and restores without changing security lockout or reviving sessions", async () => {
      const lockUntil = new Date(Date.now() + 1000);
      await prisma.user.update({
        where: { id: target.id },
        data: { lockUntil },
      });
      const suspended = await mutate(admin, target.id, "suspend", {
        expectedVersion: 0,
        reason: "Test moderation",
      });
      expect(suspended.status).toBe(200);
      expect(successBody<AdminUserDetail>(suspended)).toMatchObject({
        status: AUTH_ACCOUNT_STATUSES.suspended,
        role: AUTH_USER_ROLES.customer,
        version: 1,
      });
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(user.accessStatus).toBe(USER_ACCESS_STATUSES.suspended);
      expect(user.lockUntil).toEqual(lockUntil);
      expect((await get("/lcsp299-test/protected", target)).status).toBe(401);
      const preflight = await app.get(RbacPreflightService).evaluate({
        userId: target.id,
        requiredRoles: [AUTH_USER_ROLES.customer],
        correlationId: randomUUID(),
      });
      expect(preflight.decision).toBe(RBAC_DECISIONS.deny);
      expect(
        successBody<AdminUserDetail>(
          await mutate(admin, target.id, "restore", { expectedVersion: 1 }),
        ),
      ).toMatchObject({
        status: AUTH_ACCOUNT_STATUSES.active,
        version: 2,
        role: AUTH_USER_ROLES.customer,
      });
      expect((await get("/lcsp299-test/protected", target)).status).toBe(401);
      const records = await prisma.authRecord.findMany({
        where: { userId: target.id, type: AUTH_RECORD_TYPES.session },
      });
      expect(records.every((record) => record.revokedAt !== null)).toBe(true);
      const freshToken = randomUUID();
      await app.get(PrismaSessionRepository).save(
        new Session({
          userId: target.id,
          accessVersion: 2,
          tokenHash: hashSecret(freshToken),
          expiresAt: Date.now() + 3600000,
        }),
        fingerprintToken(freshToken),
      );
      expect(
        (await get("/lcsp299-test/protected", { ...target, token: freshToken }))
          .status,
      ).toBe(200);
    });
    it.each(Object.values(AUTH_USER_ROLES))(
      "preserves the existing %s role across suspend and restore",
      async (role) => {
        const account = await actor(role, "Immutable role account");
        const suspended = await mutate(admin, account.id, "suspend", {
          expectedVersion: 0,
        });
        expect(suspended.status).toBe(200);
        expect(successBody<AdminUserDetail>(suspended).role).toBe(role);
        const restored = await mutate(admin, account.id, "restore", {
          expectedVersion: 1,
        });
        expect(restored.status).toBe(200);
        expect(successBody<AdminUserDetail>(restored).role).toBe(role);
        const stored = await prisma.user.findUniqueOrThrow({
          where: { id: account.id },
        });
        expect(stored.role).toBe(role);
        expect(stored.accessStatus).toBe(USER_ACCESS_STATUSES.active);
        expect((await get("/lcsp299-test/protected", account)).status).toBe(
          401,
        );
      },
    );

    it("prevents stale login/MFA entities from undoing suspension or reviving sessions", async () => {
      const second = await actor(AUTH_USER_ROLES.admin, "Second Admin");
      const users = app.get(PrismaUserRepository);
      const sessions = app.get(PrismaSessionRepository);
      const staleUser = (await users.findById(second.id))!;
      const staleSession = (await sessions.findByFingerprint(
        fingerprintToken(second.token),
      ))!;
      expect(
        (await mutate(admin, second.id, "suspend", { expectedVersion: 0 }))
          .status,
      ).toBe(200);
      await users.save(staleUser);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: second.id } }))
          .role,
      ).toBe(AUTH_USER_ROLES.admin);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: second.id } }))
          .accessStatus,
      ).toBe(USER_ACCESS_STATUSES.suspended);
      staleSession.markMfaVerified(Date.now());
      await expect(sessions.save(staleSession)).rejects.toThrow();
      await expect(
        sessions.save(
          new Session({
            userId: second.id,
            accessVersion: 0,
            tokenHash: hashSecret("stale-new-session"),
            expiresAt: Date.now() + 60000,
          }),
          fingerprintToken("stale-new-session"),
        ),
      ).rejects.toThrow();
    });
    it("revalidates actor session inside the transaction", async () => {
      const record = await prisma.authRecord.findFirstOrThrow({
        where: { userId: admin.id, type: AUTH_RECORD_TYPES.session },
      });
      await prisma.authRecord.update({
        where: { id: record.id },
        data: { revokedAt: new Date() },
      });
      await expect(
        app.get(AdminAccountCommandService).mutate(
          target.id,
          ADMIN_ACCOUNT_OPERATIONS.suspend,
          { expectedVersion: 0 },
          {
            userId: admin.id,
            sessionId: record.id,
            role: AUTH_USER_ROLES.admin,
            scope: target.id,
            correlationId: randomUUID(),
            idempotencyKey: randomUUID(),
          },
        ),
      ).rejects.toThrow();
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
          .accessStatus,
      ).toBe(USER_ACCESS_STATUSES.active);
    });

    it("rejects self-suspend regardless of other usable Admins", async () => {
      expect(
        code(
          (await mutate(admin, admin.id, "suspend", { expectedVersion: 0 }))
            .body,
        ),
      ).toBe(E.selfSuspend);
      await actor(AUTH_USER_ROLES.admin, "Second Admin");
      expect(
        code(
          (await mutate(admin, admin.id, "suspend", { expectedVersion: 0 }))
            .body,
        ),
      ).toBe(E.selfSuspend);
    });
    it("does not count suspended, unverified, login-locked or MFA-locked Admins as usable replacements", async () => {
      const lastUsable = await actor(
        AUTH_USER_ROLES.admin,
        "Last usable Admin",
      );
      const unavailable = await actor(
        AUTH_USER_ROLES.admin,
        "Unavailable Admin",
      );
      // Login lockout does not revoke an authenticated session, but the actor
      // cannot count as a usable replacement for the target in this state.
      await prisma.user.update({
        where: { id: admin.id },
        data: { lockUntil: new Date(Date.now() + 60000) },
      });
      for (const data of [
        {
          accessStatus: USER_ACCESS_STATUSES.suspended,
          emailVerified: true,
          lockUntil: null,
          mfaLockedUntil: null,
        },
        {
          accessStatus: USER_ACCESS_STATUSES.active,
          emailVerified: false,
          lockUntil: null,
          mfaLockedUntil: null,
        },
        {
          accessStatus: USER_ACCESS_STATUSES.active,
          emailVerified: true,
          lockUntil: new Date(Date.now() + 60000),
          mfaLockedUntil: null,
        },
        {
          accessStatus: USER_ACCESS_STATUSES.active,
          emailVerified: true,
          lockUntil: null,
          mfaLockedUntil: new Date(Date.now() + 60000),
        },
      ]) {
        await prisma.user.update({ where: { id: unavailable.id }, data });
        expect(
          code(
            (
              await mutate(admin, lastUsable.id, "suspend", {
                expectedVersion: 0,
              })
            ).body,
          ),
        ).toBe(E.lastUsableAdmin);
      }
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: lastUsable.id },
      });
      expect(current.accessStatus).toBe(USER_ACCESS_STATUSES.active);
      expect(current.role).toBe(AUTH_USER_ROLES.admin);
      expect(await prisma.adminAccountCommandReceipt.count()).toBe(0);
    });
    it("serializes concurrent cross-suspensions so one usable Admin survives", async () => {
      const second = await actor(AUTH_USER_ROLES.admin, "Second Admin");
      const results = await Promise.all([
        mutate(admin, second.id, "suspend", { expectedVersion: 0 }),
        mutate(second, admin.id, "suspend", { expectedVersion: 0 }),
      ]);
      expect(results.filter((result) => result.status === 200)).toHaveLength(1);
      expect(
        results.filter((result) => [401, 403, 409].includes(result.status)),
      ).toHaveLength(1);
      expect(
        await prisma.user.count({
          where: {
            role: AUTH_USER_ROLES.admin,
            accessStatus: USER_ACCESS_STATUSES.active,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.user.count({ where: { role: AUTH_USER_ROLES.admin } }),
      ).toBe(2);
    });
    it("has no existing-user role route for Admin, Customer or anonymous callers", async () => {
      for (const token of [admin.token, target.token, null]) {
        let request = httpRequest(app).post(`/admin/users/${target.id}/role`);
        if (token) request = request.set("Authorization", `Bearer ${token}`);
        expect(
          (
            await request
              .set("Idempotency-Key", randomUUID())
              .send({ role: AUTH_USER_ROLES.admin, expectedVersion: 0 })
          ).status,
        ).toBe(404);
      }
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
          .role,
      ).toBe(AUTH_USER_ROLES.customer);
      expect(await prisma.adminAccountCommandReceipt.count()).toBe(0);
      expect((await get("/lcsp299-test/protected", target)).status).toBe(200);
    });
    it("rejects retired commands and role fields before changing state, audit or receipts", async () => {
      const record = await prisma.authRecord.findFirstOrThrow({
        where: { userId: admin.id, type: AUTH_RECORD_TYPES.session },
      });
      const auditCount = await prisma.auditEvent.count();
      await expect(
        app.get(AdminAccountCommandService).mutate(
          target.id,
          "ROLE_CHANGE" as AdminAccountOperation,
          { role: AUTH_USER_ROLES.admin, expectedVersion: 0 },
          {
            userId: admin.id,
            sessionId: record.id,
            role: AUTH_USER_ROLES.admin,
            scope: target.id,
            correlationId: randomUUID(),
            idempotencyKey: randomUUID(),
          },
        ),
      ).rejects.toThrow();
      expect(await prisma.auditEvent.count()).toBe(auditCount);
      for (const operation of ["suspend", "restore"])
        expect(
          (
            await mutate(admin, target.id, operation, {
              expectedVersion: 0,
              role: AUTH_USER_ROLES.admin,
            })
          ).status,
        ).toBe(400);
      expect(await prisma.adminAccountCommandReceipt.count()).toBe(0);
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(current.role).toBe(AUTH_USER_ROLES.customer);
      expect(current.accessStatus).toBe(USER_ACCESS_STATUSES.active);
      expect(current.accessVersion).toBe(0);
    });
    it("replays suspend/restore once and rejects stale versions or changed payloads", async () => {
      for (const [operation, body] of [
        ["suspend", { expectedVersion: 0, reason: "One action" }],
        ["restore", { expectedVersion: 1 }],
      ] as const) {
        const key = randomUUID();
        const results = await Promise.all([
          mutate(admin, target.id, operation, body, key),
          mutate(admin, target.id, operation, body, key),
        ]);
        expect(results.every((result) => result.status === 200)).toBe(true);
        expect(
          results.filter(
            (result) => successBody<AdminUserDetail>(result).replayed,
          ),
        ).toHaveLength(1);
        expect(
          code(
            (
              await mutate(
                admin,
                target.id,
                operation,
                { ...body, expectedVersion: 99 },
                key,
              )
            ).body,
          ),
        ).toBe(E.idempotencyConflict);
      }
      expect(
        await prisma.auditEvent.count({
          where: {
            resourceId: target.id,
            eventType: {
              in: [
                AUTH_AUDIT_EVENT_TYPES.authAdminUserSuspended,
                AUTH_AUDIT_EVENT_TYPES.authAdminUserRestored,
              ],
            },
          },
        }),
      ).toBe(2);
      expect(
        code(
          (await mutate(admin, target.id, "suspend", { expectedVersion: 0 }))
            .body,
        ),
      ).toBe(E.staleVersion);
    });
    it("rolls back state, sessions and idempotency receipt if audit persistence fails", async () => {
      const key = randomUUID();
      jest
        .spyOn(app.get(AuthAuditService), "writeInTx")
        .mockRejectedValueOnce(new Error("test-only audit failure"));
      expect(
        (await mutate(admin, target.id, "suspend", { expectedVersion: 0 }, key))
          .status,
      ).toBe(500);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: target.id } }))
          .accessVersion,
      ).toBe(0);
      expect(await prisma.adminAccountCommandReceipt.count()).toBe(0);
      expect((await get("/lcsp299-test/protected", target)).status).toBe(200);
      expect(
        (await mutate(admin, target.id, "suspend", { expectedVersion: 0 }, key))
          .status,
      ).toBe(200);
    });
    it("requires idempotency, expectedVersion and restorable state", async () => {
      expect(
        (
          await httpRequest(app)
            .post(`/admin/users/${target.id}/suspend`)
            .set("Authorization", `Bearer ${admin.token}`)
            .send({ expectedVersion: 0 })
        ).status,
      ).toBe(400);
      expect(
        (
          await mutate(admin, target.id, "suspend", {
            role: AUTH_USER_ROLES.admin,
            expectedVersion: 0,
          })
        ).status,
      ).toBe(400);
      expect((await mutate(admin, target.id, "suspend", {})).status).toBe(400);
      expect(
        code(
          (await mutate(admin, target.id, "restore", { expectedVersion: 0 }))
            .body,
        ),
      ).toBe(E.invalidState);
    });
    it("uses server-side search, canonical filters, bounded pages and a stable tie-breaker", async () => {
      await prisma.user.updateMany({
        data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      });
      const first = await get("/admin/users?pageSize=1&page=1");
      const second = await get("/admin/users?pageSize=1&page=2");
      expect([
        successBody<AdminUserListResponse>(first).users[0].id,
        successBody<AdminUserListResponse>(second).users[0].id,
      ]).toEqual([admin.id, target.id].sort());
      const search = await get(
        "/admin/users?q=Target&role=CUSTOMER&status=ACTIVE",
      );
      expect(
        successBody<AdminUserListResponse>(search).users.map(
          (row: { id: string }) => row.id,
        ),
      ).toEqual([target.id]);
      expect(
        successBody<AdminUserListResponse>(
          await get(
            `/admin/users?q=${encodeURIComponent(target.email.toUpperCase())}`,
          ),
        ).totalCount,
      ).toBe(1);
      for (const query of [
        "pageSize=101",
        "page=0",
        "role=ROOT",
        "status=LOCKED",
      ])
        expect((await get(`/admin/users?${query}`)).status).toBe(400);
      expect(
        successBody<AdminUserListResponse>(await get("/admin/users?q=%25"))
          .totalCount,
      ).toBe(0);
    });
    it("returns only safe metadata and authoritative bounded 30-day usage", async () => {
      await prisma.assessment.createMany({
        data: [
          { id: randomUUID(), ownerId: target.id, name: "Recent" },
          {
            id: randomUUID(),
            ownerId: target.id,
            name: "Old",
            createdAt: new Date(Date.now() - 31 * 86400000),
          },
        ],
      });
      const detail = await get(`/admin/users/${target.id}`);
      expect(successBody<AdminUserDetail>(detail).usageSummary).toMatchObject({
        assessments30d: 1,
        creditSpend30d: null,
        openFindingsCount: null,
      });
      expect(
        successBody<AdminUserDetail>(detail).usageSummary.lastAssessmentAt,
      ).not.toBeNull();
      expect(
        successBody<AdminUserListResponse>(await get("/admin/users?q=Target"))
          .users[0].assessmentCount,
      ).toBe(2);
      const serialized = JSON.stringify(detail.body);
      for (const forbidden of [
        "passwordHash",
        "mfaEncryptedSecret",
        "secretHash",
        "authRecords",
        "recoveryEmail",
        target.token,
      ])
        expect(serialized).not.toContain(forbidden);
    });
    it("creates an invitation, not a fake User, and consumes its token once", async () => {
      const email = "invitee@example.com";
      const response = await invite(email, randomUUID(), AUTH_USER_ROLES.admin);
      expect(response.status).toBe(201);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      const token = tokenFromMail();
      expect(JSON.stringify(response.body)).not.toContain(token);
      const record = await prisma.accountInvitation.findUniqueOrThrow({
        where: { email },
      });
      expect(record.tokenHash).toBe(fingerprintToken(token));
      expect(record.encryptedToken).toBeNull();
      expect(code((await invite(email.toUpperCase())).body)).toBe(
        E.duplicateInvitation,
      );
      expect(
        successBody<AdminUserListResponse>(
          await get("/admin/users?status=INVITED"),
        ).users,
      ).toHaveLength(1);
      expect((await accept(token)).status).toBe(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.role).toBe(AUTH_USER_ROLES.admin);
      expect(
        await prisma.authRecord.count({ where: { userId: user.id } }),
      ).toBe(0);
      expect(
        (await prisma.accountInvitation.findUniqueOrThrow({ where: { email } }))
          .status,
      ).toBe(ACCOUNT_INVITATION_STATUSES.accepted);
      expect((await accept(token)).status).toBe(400);
      expect(code((await invite(email)).body)).toBe(E.duplicateAccount);
    });
    it("consumes only once under simultaneous invitation acceptance", async () => {
      await invite("parallel@example.com");
      const token = tokenFromMail();
      const results = await Promise.all([accept(token), accept(token)]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
      expect(
        await prisma.user.count({ where: { email: "parallel@example.com" } }),
      ).toBe(1);
    });
    it("retries SMTP failure with the same token and does not simulate delivery", async () => {
      mailFails = true;
      const key = randomUUID();
      expect((await invite("retry@example.com", key)).status).toBe(503);
      const firstToken = tokenFromMail();
      mailFails = false;
      expect((await invite("retry@example.com", key)).status).toBe(201);
      expect(tokenFromMail()).toBe(firstToken);
      expect(await prisma.accountInvitation.count()).toBe(1);
      expect((await invite("retry@example.com", key)).status).toBe(201);
      expect(deliveries).toHaveLength(2);
    });
    it("pins retries to one invitation generation across expiry and reissue", async () => {
      const oldKey = randomUUID();
      const newKey = randomUUID();
      await invite("generation@example.com", oldKey);
      const oldToken = tokenFromMail();
      await prisma.accountInvitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const fresh = await invite("generation@example.com", newKey);
      const freshToken = tokenFromMail();
      expect(fresh.status).toBe(201);
      expect(freshToken).not.toBe(oldToken);
      const count = deliveries.length;
      expect(code((await invite("generation@example.com", oldKey)).body)).toBe(
        E.staleInvitation,
      );
      expect(deliveries).toHaveLength(count);
      expect((await accept(oldToken)).status).toBe(400);
      expect((await accept(freshToken)).status).toBe(200);
    });
    it("rejects expired tokens, role spoofing and missing delivery configuration", async () => {
      await invite("expired@example.com");
      const token = tokenFromMail();
      expect(
        (
          await httpRequest(app)
            .post("/auth/invitations/accept")
            .send({ token, password: PASSWORD, role: AUTH_USER_ROLES.admin })
        ).status,
      ).toBe(400);
      await prisma.accountInvitation.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await accept(token)).status).toBe(400);
      mailConfigured = false;
      expect((await invite("unconfigured@example.com")).status).toBe(503);
      expect(
        await prisma.accountInvitation.findUnique({
          where: { email: "unconfigured@example.com" },
        }),
      ).toBeNull();
    });
  },
);
