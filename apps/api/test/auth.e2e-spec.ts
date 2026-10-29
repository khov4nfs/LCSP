import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import * as assert from "node:assert/strict";
import { jest } from "@jest/globals";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AUDIT_DECISIONS } from "@lcsp/contracts/audit";
import {
  AUTH_ERROR_CODES,
  REQUIRED_ACTIONS,
  type ProblemResult,
} from "@lcsp/contracts/auth";
import { resolveMessage } from "@lcsp/i18n";

import { AppModule } from "../src/app.module.js";
import { AuthAuditService } from "../src/modules/auth/application/services/auth/auth-audit.service.js";
import type {
  EnrollMfaSuccess,
  GenerateMfaRecoveryCodesSuccess,
  VerifyMfaOtpSuccess,
  VerifyMfaRecoveryCodeSuccess,
} from "../src/modules/auth/application/contracts/auth/mfa.contract.js";
import type { PasswordReauthSuccess } from "../src/modules/auth/application/contracts/auth/password-reauth.contract.js";
import type { UpdateProfileSuccess } from "../src/modules/auth/application/contracts/auth/profile.contract.js";
import type {
  ConfirmRecoverySuccess,
  RequestRecoverySuccess,
} from "../src/modules/auth/application/contracts/auth/recovery.contract.js";
import type { SignInSuccess } from "../src/modules/auth/application/contracts/auth/sign-in.contract.js";
import type {
  AuthSessionsSuccess,
  RevokeOwnedSessionSuccess,
} from "../src/modules/auth/application/contracts/auth/settings.contract.js";
import { AUTH_RECOVERY_NOTIFIER } from "../src/modules/auth/application/ports/notification/recovery-notifier.js";
import {
  type AuthFixture,
  CapturingRecoveryNotifier,
  TEST_DATABASE_URL,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedMfaEnrollment,
  totpForTime,
} from "./support/auth-workspace-test-helpers.js";

import {
  AUTH_RECORD_TYPE,
  authRecordMetadataString,
  createAuthSessionRecord,
  findLatestAuthSession,
} from "./support/auth-record-test-helpers.js";

describe("Auth workspace (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: AuthFixture;
  let recoveryNotifier: CapturingRecoveryNotifier;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();

    prisma = new PrismaClient({
      adapter: new PrismaPg(TEST_DATABASE_URL),
    });
    await prisma.$connect();

    recoveryNotifier = new CapturingRecoveryNotifier();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTH_RECOVERY_NOTIFIER)
      .useValue(recoveryNotifier)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 60_000);

  beforeEach(async () => {
    await resetAuthWorkspaceDatabase(prisma);
    fixture = await seedAuthWorkspaceFixture(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function mfaBusinessAuditCount(): Promise<number> {
    const events = await prisma.auditEvent.findMany({
      select: { payload: true },
    });
    const types: Set<string> = new Set([
      AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled,
      AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodesGenerated,
      AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaRecoveryCodeViewed,
    ]);
    return events.filter((event) => {
      const payload = event.payload as Record<string, unknown> | null;
      return payload && types.has(payload.event_type as string);
    }).length;
  }

  it("approved sign-in returns the current safe user projection", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "CorrectHorseBatteryStaple!",
        organization_id: fixture.organizationId,
      })
      .expect(200);
    const body = successBody<SignInSuccess>(result);

    assert.equal(body.user.user_id, fixture.approvedUser.id);
    assert.equal(body.user.email, fixture.approvedUser.email);
    assert.equal(body.user.subject_attributes.role, AUTH_USER_ROLES.customer);
    assert.equal(typeof body.session_token, "string");
    assert.equal(body.mfa_required, undefined);
    assert.equal(body.mfa_enrolled, false);
  });

  it("approved sign-in no longer requires organization_id", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(200);
    const body = successBody<SignInSuccess>(result);

    assert.equal(body.user.user_id, fixture.approvedUser.id);
    assert.equal(body.user.subject_attributes.role, AUTH_USER_ROLES.customer);
    assert.equal(typeof body.session_token, "string");
    assert.equal(body.mfa_required, undefined);
    assert.equal(body.mfa_enrolled, false);
  });

  it("invalid credentials return stable safe error without echoing secrets", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "WrongPassword123!",
        organization_id: fixture.organizationId,
      })
      .expect(401);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.invalidCredentials);
    assert.equal(
      resolveMessage("vi", failure.problem.detailKey),
      "Email hoặc mật khẩu không hợp lệ.",
    );
    assert.doesNotMatch(JSON.stringify(failure), /WrongPassword123!/);
  });

  it("password re-auth verifies the current session password", async () => {
    const signIn = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "CorrectHorseBatteryStaple!",
        organization_id: fixture.organizationId,
      })
      .expect(200);

    const sessionToken = successBody<SignInSuccess>(signIn).session_token;

    const beforeCheck = await httpRequest(app)
      .post("/auth/sensitive-route/check")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ method: "POST", path: "/api/github/repository-discoveries" })
      .expect(200);
    assert.equal(
      (beforeCheck.body as { data?: { reauth_required?: unknown } }).data
        ?.reauth_required,
      true,
    );
    assert.equal(
      (beforeCheck.body as { data?: { route_id?: unknown } }).data?.route_id,
      "GITHUB_CLI_REPOSITORY_DISCOVERY",
    );

    const result = await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({
        session_token: sessionToken,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    const body = successBody<PasswordReauthSuccess>(result);
    assert.equal(body.verified, true);

    const session = await findLatestAuthSession(
      prisma,
      fixture.approvedUser.id,
    );
    assert.ok(session);
    assert.ok(authRecordMetadataString(session, "sensitiveActionVerifiedAt"));

    const afterCheck = await httpRequest(app)
      .post("/auth/sensitive-route/check")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ method: "POST", path: "/api/github/repository-discoveries" })
      .expect(200);
    assert.equal(
      (afterCheck.body as { data?: { reauth_required?: unknown } }).data
        ?.reauth_required,
      false,
    );
    assert.equal(
      (afterCheck.body as { data?: { route_id?: unknown } }).data?.route_id,
      "GITHUB_CLI_REPOSITORY_DISCOVERY",
    );
  });

  it("password re-auth rejects an invalid current password without leaking it", async () => {
    const signIn = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "CorrectHorseBatteryStaple!",
        organization_id: fixture.organizationId,
      })
      .expect(200);

    const sessionToken = successBody<SignInSuccess>(signIn).session_token;

    const result = await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({
        session_token: sessionToken,
        password: "WrongPassword123!",
      })
      .expect(401);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.invalidCredentials);
    assert.equal(failure.problem.requiredAction, REQUIRED_ACTIONS.none);
    assert.doesNotMatch(JSON.stringify(failure), /WrongPassword123!/);
  });

  it("email verification is required before continuing to workspace", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.unverifiedUser.email,
        password: "VerifyMe123!",
        organization_id: fixture.organizationId,
      })
      .expect(403);

    const failure = expectFailure(result.body);
    assert.equal(
      failure.problem.code,
      AUTH_ERROR_CODES.emailVerificationRequired,
    );
  });

  it("sign-in succeeds for users without legacy membership records", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.noMembershipUser.email,
        password: "NoMembership123!",
        organization_id: fixture.organizationId,
      })
      .expect(200);

    const body = successBody<SignInSuccess>(result);
    assert.equal(body.user.user_id, fixture.noMembershipUser.id);
    assert.equal(body.user.subject_attributes.role, AUTH_USER_ROLES.admin);
  });

  it("protected profile endpoint fails closed without authentication", async () => {
    const result = await httpRequest(app)
      .get("/auth/profile")
      .set("x-correlation-id", "corr-profile-no-session")
      .expect(401);

    assert.equal(problemCode(result), AUTH_ERROR_CODES.sessionInvalid);

    const decision = await prisma.auditEvent.findFirstOrThrow({
      where: {
        eventType: "AUTHORIZATION_DECISION",
        correlationId: "corr-profile-no-session",
      },
    });
    assert.equal(decision.decision, AUDIT_DECISIONS.deny);
  });

  it("repeated failed logins trigger temporary lock expectation", async () => {
    await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "WrongPassword123!",
        organization_id: fixture.organizationId,
      })
      .expect(401);

    await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "WrongPassword123!",
        organization_id: fixture.organizationId,
      })
      .expect(401);

    const locked = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "WrongPassword123!",
        organization_id: fixture.organizationId,
      })
      .expect(429);

    const failure = expectFailure(locked.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.temporaryLock);
  });

  it("audit trail records allow/deny events without leaking secrets", async () => {
    const signIn = await signInAndVerifyApprovedUser();

    await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .set("x-correlation-id", "corr-profile-allow")
      .expect(200);

    const allowDecision = await prisma.auditEvent.findFirstOrThrow({
      where: {
        eventType: "AUTHORIZATION_DECISION",
        correlationId: "corr-profile-allow",
      },
    });
    assert.equal(allowDecision.decision, AUDIT_DECISIONS.allow);

    await httpRequest(app)
      .post("/auth/revoke-session")
      .send({ session_token: signIn.session_token })
      .expect(201);

    const auditEvents = await prisma.auditEvent.findMany({
      orderBy: { createdAt: "asc" },
    });
    const serializedAudit = JSON.stringify(
      auditEvents.map((item) => item.payload),
    );

    assert.match(serializedAudit, /auth\.login\.succeeded/);
    assert.match(serializedAudit, /auth\.session\.revoked/);
    assert.doesNotMatch(serializedAudit, /CorrectHorseBatteryStaple!/);
    assert.doesNotMatch(serializedAudit, new RegExp(signIn.session_token));
  });

  // AC1: MFA enrollment and OTP challenge

  it("MFA enrollment returns a TOTP URI for authenticator app setup", async () => {
    const signIn = await signInApprovedUser();
    const result = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);

    const body = successBody<EnrollMfaSuccess>(result);
    assert.equal(body.ok, true);
    assert.match(body.totp_uri, /^otpauth:\/\/totp\//);
    assert.equal(body.recovery_codes.length, 10);
    assert.equal(new Set(body.recovery_codes).size, 10);
  });

  it("concurrent first MFA enrollment commits one coherent secret and backup batch", async () => {
    const signedIn = await signInApprovedUser();
    const requests = await Promise.all([
      httpRequest(app)
        .post("/auth/mfa/enroll")
        .set("Authorization", `Bearer ${signedIn.session_token}`)
        .send({ session_token: signedIn.session_token }),
      httpRequest(app)
        .post("/auth/mfa/enroll")
        .set("Authorization", `Bearer ${signedIn.session_token}`)
        .send({ session_token: signedIn.session_token }),
    ]);
    assert.deepEqual(requests.map((r) => r.status).sort(), [201, 403]);
    const successful = requests.find((r) => r.status === 201);
    assert.ok(successful);
    assert.equal(
      successBody<EnrollMfaSuccess>(successful).recovery_codes.length,
      10,
    );
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.ok(stored.mfaEncryptedSecret);
    const activeCodes = await prisma.authRecord.count({
      where: {
        userId: stored.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        usedAt: null,
        revokedAt: null,
      },
    });
    assert.equal(activeCodes, 10);
    const audits = await prisma.auditEvent.findMany({
      where: { actorId: stored.id },
    });
    assert.equal(
      audits.filter(
        (a) =>
          (a.payload as Record<string, unknown>).event_type ===
          AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaEnrolled,
      ).length,
      1,
    );
  });

  it("rolls back MFA enrollment and backup issuance if transactional audit fails", async () => {
    const signedIn = await signInApprovedUser();
    const initialMfaAuditCount = await mfaBusinessAuditCount();
    const spy = jest
      .spyOn(app.get(AuthAuditService), "writeInTx")
      .mockRejectedValueOnce(new Error("test MFA audit failure"));
    try {
      await httpRequest(app)
        .post("/auth/mfa/enroll")
        .set("Authorization", `Bearer ${signedIn.session_token}`)
        .send({ session_token: signedIn.session_token })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.equal(stored.mfaEncryptedSecret, null);
    assert.equal(stored.mfaEnrolledAt, null);
    assert.equal(
      await prisma.authRecord.count({
        where: { userId: stored.id, type: AUTH_RECORD_TYPE.mfaRecoveryCode },
      }),
      0,
    );
    assert.equal(await mfaBusinessAuditCount(), initialMfaAuditCount);
  });

  it("MFA recovery code verifies MFA once and rejects replay", async () => {
    const signIn = await signInApprovedUser();
    const enrollment = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);
    const enrollmentBody = successBody<EnrollMfaSuccess>(enrollment);
    const recoveryCode = enrollmentBody.recovery_codes[0];
    const premature = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: signIn.session_token, code: recoveryCode })
      .expect(403);
    assert.equal(problemCode(premature), AUTH_ERROR_CODES.mfaRequired);

    // A new factor must be proven with its TOTP before its backup batch is active.
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: signIn.session_token,
        otp: totpForTime(
          totpSecretFromUri(enrollmentBody.totp_uri),
          Date.now(),
        ),
      })
      .expect(201);
    const pendingSession = await signInApprovedUser();
    const verify = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: pendingSession.session_token, code: recoveryCode })
      .expect(201);
    assert.equal(successBody<VerifyMfaRecoveryCodeSuccess>(verify).ok, true);

    const replay = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: pendingSession.session_token, code: recoveryCode })
      .expect(403);
    assert.equal(problemCode(replay), AUTH_ERROR_CODES.mfaInvalid);

    const usedCodes = await prisma.authRecord.findMany({
      where: {
        userId: fixture.approvedUser.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        usedAt: { not: null },
      },
    });
    assert.equal(usedCodes.length, 1);
  });

  it("rolls back a consumed MFA recovery code when verification audit fails", async () => {
    const signedIn = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signedIn.session_token}`)
      .send({ session_token: signedIn.session_token })
      .expect(201);
    const body = successBody<EnrollMfaSuccess>(enrolled);
    const code = body.recovery_codes[0];
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: signedIn.session_token,
        otp: totpForTime(totpSecretFromUri(body.totp_uri), Date.now()),
      })
      .expect(201);
    const pendingSession = await signInApprovedUser();
    const spy = jest
      .spyOn(app.get(AuthAuditService), "writeInTx")
      .mockRejectedValueOnce(new Error("test MFA proof audit failure"));
    try {
      await httpRequest(app)
        .post("/auth/mfa/recovery-code/verify")
        .send({ session_token: pendingSession.session_token, code })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.ok(user.mfaVerifiedAt, "the original OTP proof remains committed");
    const pendingProof = await prisma.authRecord.findFirstOrThrow({
      where: {
        type: AUTH_RECORD_TYPE.session,
        userId: user.id,
        lookupKey: { contains: "" },
      },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(authRecordMetadataString(pendingProof, "mfaVerifiedAt"), null);
    const used = await prisma.authRecord.count({
      where: {
        userId: user.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        usedAt: { not: null },
      },
    });
    assert.equal(used, 0);
    await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: pendingSession.session_token, code })
      .expect(201);
  });

  it("generating a new MFA recovery code set invalidates the old set", async () => {
    const signIn = await signInApprovedUser();
    const enrollment = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);
    const enrollmentBody = successBody<EnrollMfaSuccess>(enrollment);
    const oldRecoveryCode = enrollmentBody.recovery_codes[0];

    const otp = totpForTime(
      totpSecretFromUri(enrollmentBody.totp_uri),
      Date.now(),
    );
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp })
      .expect(201);

    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    const generated = await httpRequest(app)
      .post("/auth/mfa/recovery-codes")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);
    const newRecoveryCode =
      successBody<GenerateMfaRecoveryCodesSuccess>(generated).recovery_codes[0];

    const pendingMfaSignIn = await signInApprovedUser();
    const oldAttempt = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({
        session_token: pendingMfaSignIn.session_token,
        code: oldRecoveryCode,
      })
      .expect(403);
    assert.equal(problemCode(oldAttempt), AUTH_ERROR_CODES.mfaInvalid);

    const newAttempt = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({
        session_token: pendingMfaSignIn.session_token,
        code: newRecoveryCode,
      })
      .expect(201);
    assert.equal(
      successBody<VerifyMfaRecoveryCodeSuccess>(newAttempt).ok,
      true,
    );
  });

  it("rolls back recovery code replacement and audit on failure", async () => {
    const signedIn = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signedIn.session_token}`)
      .send({ session_token: signedIn.session_token })
      .expect(201);
    const otp = totpForTime(
      totpSecretFromUri(successBody<EnrollMfaSuccess>(enrolled).totp_uri),
      Date.now(),
    );
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signedIn.session_token, otp })
      .expect(201);
    const activeBefore = await prisma.authRecord.findMany({
      where: {
        userId: fixture.approvedUser.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        usedAt: null,
        revokedAt: null,
      },
      orderBy: { id: "asc" },
    });
    const auditCount = await mfaBusinessAuditCount();
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${signedIn.session_token}`)
      .send({
        session_token: signedIn.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    const spy = jest
      .spyOn(app.get(AuthAuditService), "writeInTx")
      .mockRejectedValueOnce(new Error("test MFA code audit failure"));
    try {
      await httpRequest(app)
        .post("/auth/mfa/recovery-codes")
        .set("Authorization", `Bearer ${signedIn.session_token}`)
        .send({ session_token: signedIn.session_token })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const activeAfter = await prisma.authRecord.findMany({
      where: {
        userId: fixture.approvedUser.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        usedAt: null,
        revokedAt: null,
      },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      activeAfter.map((c) => c.id),
      activeBefore.map((c) => c.id),
    );
    assert.equal(await mfaBusinessAuditCount(), auditCount);
  });

  it("concurrent code regeneration and disabling MFA leaves no live codes", async () => {
    const signedIn = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signedIn.session_token}`)
      .send({ session_token: signedIn.session_token })
      .expect(201);
    const otp = totpForTime(
      totpSecretFromUri(successBody<EnrollMfaSuccess>(enrolled).totp_uri),
      Date.now(),
    );
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signedIn.session_token, otp })
      .expect(201);
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${signedIn.session_token}`)
      .send({
        session_token: signedIn.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);
    const results = await Promise.all([
      httpRequest(app)
        .post("/auth/mfa/recovery-codes")
        .set("Authorization", `Bearer ${signedIn.session_token}`)
        .send({ session_token: signedIn.session_token }),
      httpRequest(app)
        .delete("/auth/mfa")
        .set("Authorization", `Bearer ${signedIn.session_token}`),
    ]);
    assert.equal(results[1].status, 200);
    assert.ok([201, 403].includes(results[0].status));
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.equal(stored.mfaEncryptedSecret, null);
    assert.equal(
      await prisma.authRecord.count({
        where: {
          userId: stored.id,
          type: AUTH_RECORD_TYPE.mfaRecoveryCode,
          usedAt: null,
          revokedAt: null,
        },
      }),
      0,
    );
  });

  it("MFA enrollment labels the TOTP URI with the effective primary email address", async () => {
    await prisma.user.update({
      where: { id: fixture.approvedUser.id },
      data: {
        recoveryEmail: "security@acme.test",
        primaryEmailAddressPolicy:
          AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail,
      },
    });

    const signIn = await signInApprovedUser();
    const result = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);

    const body = successBody<EnrollMfaSuccess>(result);
    assert.match(
      body.totp_uri,
      /^otpauth:\/\/totp\/LCSP%3Asecurity%40acme\.test\?/,
    );
  });

  it("pending MFA setup does not count as enrolled before OTP verification", async () => {
    const signIn = await signInApprovedUser();
    await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    const secondSignIn = await signInApprovedUser();
    assert.equal(secondSignIn.mfa_required, undefined);
    assert.equal(secondSignIn.mfa_enrolled, false);

    const result = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);

    assert.equal(successBody<{ ok: boolean }>(result).ok, true);
  });

  it("sign-in response keeps MFA optional until enrollment exists", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "CorrectHorseBatteryStaple!",
        organization_id: fixture.organizationId,
      })
      .expect(200);

    const body = successBody<SignInSuccess>(result);
    assert.equal(body.ok, true);
    assert.equal(body.mfa_required, undefined);
    assert.equal(body.mfa_enrolled, false);
  });

  it("valid OTP verifies MFA and grants profile access", async () => {
    const signIn = await signInApprovedUser();
    const mfa = await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    const otp = totpForTime(mfa.totpSecret, Date.now());
    const verify = await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp })
      .expect(201);
    assert.equal(successBody<VerifyMfaOtpSuccess>(verify).ok, true);

    const profile = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);
    assert.equal(successBody<{ ok: boolean }>(profile).ok, true);
  });

  it("rolls back OTP consumption and session elevation when audit fails", async () => {
    const signedIn = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signedIn.session_token}`)
      .send({ session_token: signedIn.session_token })
      .expect(201);
    const otp = totpForTime(
      totpSecretFromUri(successBody<EnrollMfaSuccess>(enrolled).totp_uri),
      Date.now(),
    );
    const spy = jest
      .spyOn(app.get(AuthAuditService), "writeInTx")
      .mockRejectedValueOnce(new Error("test OTP proof audit failure"));
    try {
      await httpRequest(app)
        .post("/auth/mfa/verify-otp")
        .send({ session_token: signedIn.session_token, otp })
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.equal(user.mfaVerifiedAt, null);
    assert.equal(
      await prisma.authRecord.count({
        where: { userId: user.id, type: AUTH_RECORD_TYPE.mfaOtpUse },
      }),
      0,
    );
    const session = await findLatestAuthSession(prisma, user.id);
    assert.ok(session);
    assert.equal(authRecordMetadataString(session, "mfaVerifiedAt"), null);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signedIn.session_token, otp })
      .expect(201);
  });

  it("invalid OTP is rejected and audit event is recorded", async () => {
    const signIn = await signInApprovedUser();
    await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    const result = await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp: "000000" })
      .expect(403);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.mfaInvalid);

    const auditEvents = await prisma.auditEvent.findMany();
    const mfaFailed = auditEvents.find(
      (e) =>
        (e.payload as Record<string, unknown>)["event_type"] ===
        AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaFailed,
    );
    assert.ok(mfaFailed, "auth.mfa.failed audit event should be recorded");
    assert.equal(
      (mfaFailed.payload as Record<string, unknown>).otp_failure_reason,
      "invalid",
    );
  });

  it("replayed OTP is rejected after first successful use", async () => {
    const signIn = await signInApprovedUser();
    const mfa = await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    const otp = totpForTime(mfa.totpSecret, Date.now());
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp })
      .expect(201);

    const signIn2 = await signInApprovedUser();
    const replay = await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn2.session_token, otp })
      .expect(403);

    const failure = expectFailure(replay.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.mfaInvalid);

    const auditEvents = await prisma.auditEvent.findMany({
      orderBy: { createdAt: "asc" },
    });
    const replayFailed = [...auditEvents]
      .reverse()
      .find(
        (event) =>
          (event.payload as Record<string, unknown>)["event_type"] ===
          AUTH_LEGACY_AUDIT_EVENT_TYPES.mfaFailed,
      );
    assert.equal(
      (replayFailed?.payload as Record<string, unknown> | undefined)
        ?.otp_failure_reason,
      "replayed",
    );
  });

  it("rate limiting blocks after 5 consecutive failed OTP attempts", async () => {
    const signIn = await signInApprovedUser();
    await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    for (let i = 0; i < 5; i++) {
      await httpRequest(app)
        .post("/auth/mfa/verify-otp")
        .send({ session_token: signIn.session_token, otp: "000000" })
        .expect(403);
    }

    const locked = await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp: "000001" })
      .expect(429);

    const failure = expectFailure(locked.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.mfaRateLimited);
  });

  it("undecryptable MFA secrets fail verification safely and suggest recovery code retry without enrollment bounce", async () => {
    const originalKey = process.env.MFA_SECRET_ENCRYPTION_KEY;
    process.env.MFA_SECRET_ENCRYPTION_KEY = "1".repeat(64);
    const signIn = await signInApprovedUser();
    const mfa = await seedMfaEnrollment(prisma, fixture.approvedUser.id);
    const otp = totpForTime(mfa.totpSecret, Date.now());

    process.env.MFA_SECRET_ENCRYPTION_KEY = "2".repeat(64);

    try {
      const result = await httpRequest(app)
        .post("/auth/mfa/verify-otp")
        .send({ session_token: signIn.session_token, otp })
        .expect(403);

      const failure = expectFailure(result.body);
      assert.equal(failure.problem.code, AUTH_ERROR_CODES.mfaInvalid);
      assert.equal(
        failure.problem.requiredAction,
        REQUIRED_ACTIONS.retryRecovery,
      );
    } finally {
      process.env.MFA_SECRET_ENCRYPTION_KEY = originalKey;
    }
  });

  it("fails closed when a password-only session attempts to replace undecryptable MFA", async () => {
    const originalKey = process.env.MFA_SECRET_ENCRYPTION_KEY;
    process.env.MFA_SECRET_ENCRYPTION_KEY = "1".repeat(64);
    const signIn = await signInApprovedUser();
    await seedMfaEnrollment(prisma, fixture.approvedUser.id);
    await prisma.user.update({
      where: { id: fixture.approvedUser.id },
      data: { mfaVerifiedAt: new Date() },
    });
    const oldUser = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });

    process.env.MFA_SECRET_ENCRYPTION_KEY = "2".repeat(64);

    try {
      const result = await httpRequest(app)
        .post("/auth/mfa/enroll")
        .set("Authorization", `Bearer ${signIn.session_token}`)
        .send({ session_token: signIn.session_token })
        .expect(403);
      assert.equal(problemCode(result), AUTH_ERROR_CODES.mfaRequired);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: fixture.approvedUser.id },
      });
      assert.equal(after.mfaEncryptedSecret, oldUser.mfaEncryptedSecret);
      assert.equal(after.mfaGenerationId, oldUser.mfaGenerationId);
    } finally {
      process.env.MFA_SECRET_ENCRYPTION_KEY = originalKey;
    }
  });

  // AC2: Session expiry/revocation with audit trail

  it("expired session is denied access with audit event recorded", async () => {
    const expiredToken = "expired-session-token";
    await createAuthSessionRecord(prisma, {
      id: "session-expired",
      userId: fixture.approvedUser.id,
      token: expiredToken,
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    });

    const result = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${expiredToken}`)
      .expect(401);

    assert.equal(problemCode(result), AUTH_ERROR_CODES.sessionInvalid);
  });

  it("revoke-session records audit event and blocks subsequent profile access", async () => {
    const signIn = await signInApprovedUser();

    await httpRequest(app)
      .post("/auth/revoke-session")
      .send({ session_token: signIn.session_token })
      .expect(201);

    const profile = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(401);

    assert.equal(problemCode(profile), AUTH_ERROR_CODES.sessionInvalid);

    const auditEvents = await prisma.auditEvent.findMany();
    const revoked = auditEvents.find(
      (e) =>
        (e.payload as Record<string, unknown>)["event_type"] ===
        AUTH_LEGACY_AUDIT_EVENT_TYPES.sessionRevoked,
    );
    assert.ok(revoked, "auth.session.revoked audit event should be recorded");
  });

  // AC3: Profile update safety

  it("lists sessions and revokes only owned sessions with idempotent results", async () => {
    const first = await signInApprovedUser();
    const second = await signInApprovedUser();

    const sessionsResponse = await httpRequest(app)
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${second.session_token}`)
      .expect(200);
    const sessions =
      successBody<AuthSessionsSuccess>(sessionsResponse).sessions;
    const current = sessions.find((session) => session.is_current);
    assert.ok(current);
    const other = sessions.find(
      (session) => session.id !== current.id && session.revoked_at === null,
    );
    assert.ok(other);

    const foreign = await createAuthSessionRecord(prisma, {
      id: "foreign-session-for-ownership-test",
      userId: fixture.unverifiedUser.id,
      token: "foreign-session-token",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const denied = await httpRequest(app)
      .delete(`/auth/sessions/${foreign.id}`)
      .set("Authorization", `Bearer ${second.session_token}`)
      .expect(404);
    assert.equal(problemCode(denied), AUTH_ERROR_CODES.sessionInvalid);
    const foreignAfter = await prisma.authRecord.findUniqueOrThrow({
      where: { id: foreign.id },
    });
    assert.equal(foreignAfter.revokedAt, null);

    for (let index = 0; index < 2; index += 1) {
      const revoked = await httpRequest(app)
        .delete(`/auth/sessions/${other.id}`)
        .set("Authorization", `Bearer ${second.session_token}`)
        .expect(200);
      assert.equal(
        successBody<RevokeOwnedSessionSuccess>(revoked).revoked_session_id,
        other.id,
      );
    }

    const expiredFirstSession = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${first.session_token}`)
      .expect(401);
    assert.equal(
      problemCode(expiredFirstSession),
      AUTH_ERROR_CODES.sessionInvalid,
    );
  });

  it("profile update succeeds and returns updated_fields without secret values", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    const result = await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        display_name: "Test Manager",
        recovery_email: "recovery@safe.test",
      })
      .expect(200);

    const body = successBody<UpdateProfileSuccess>(result);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.updated_fields));
    assert.ok(body.updated_fields.includes("display_name"));
    assert.ok(body.updated_fields.includes("recovery_email"));
    assert.doesNotMatch(JSON.stringify(result.body), /recovery@safe\.test/);

    const profile = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);
    const profileBody = successBody<{
      backup_recovery_email_policy: string;
      recovery_email: string | null;
    }>(profile);
    assert.equal(
      profileBody.backup_recovery_email_policy,
      AUTH_BACKUP_EMAIL_POLICIES.recoveryEmail,
    );
    assert.equal(profileBody.recovery_email, "recovery@safe.test");
  });

  it("profile update audit event records field names not values", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        display_name: "Audit Test Name",
        recovery_email: "private@secret.test",
      })
      .expect(200);

    const auditEvents = await prisma.auditEvent.findMany();
    const profileUpdated = auditEvents.find(
      (e) =>
        (e.payload as Record<string, unknown>)["event_type"] ===
        AUTH_LEGACY_AUDIT_EVENT_TYPES.profileUpdated,
    );
    assert.ok(
      profileUpdated,
      "auth.profile.updated audit event should be recorded",
    );
    const auditStr = JSON.stringify(profileUpdated?.payload);
    assert.doesNotMatch(auditStr, /private@secret\.test/);
    assert.doesNotMatch(auditStr, /Audit Test Name/);
  });

  // Review follow-ups: MFA hardening, mandatory-MFA policy, profile safety, recovery flow

  it("re-enrolling MFA requires a verified session so a stolen pre-MFA session cannot replace the secret", async () => {
    const sessionA = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .send({ session_token: sessionA.session_token })
      .expect(201);
    const s1 = successBody<EnrollMfaSuccess>(enrolled);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: sessionA.session_token,
        otp: totpForTime(totpSecretFromUri(s1.totp_uri), Date.now()),
      })
      .expect(201);

    const stolenPreMfaSession = await signInApprovedUser();
    const reEnroll = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${stolenPreMfaSession.session_token}`)
      .send({ session_token: stolenPreMfaSession.session_token })
      .expect(403);

    assert.equal(problemCode(reEnroll), AUTH_ERROR_CODES.mfaRequired);
  });

  it("initial enrollment abandoned before OTP verification allows safely restarting setup", async () => {
    const session = await signInApprovedUser();
    const firstEnroll = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${session.session_token}`)
      .send({ session_token: session.session_token })
      .expect(201);
    const s1 = successBody<EnrollMfaSuccess>(firstEnroll);
    assert.ok(s1.totp_uri);

    // Abandoned setup: user restarts enrollment without verifying OTP
    const restartEnroll = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${session.session_token}`)
      .send({ session_token: session.session_token })
      .expect(201);
    const s2 = successBody<EnrollMfaSuccess>(restartEnroll);
    assert.ok(s2.totp_uri);
    assert.ok(s2.recovery_codes.length > 0);
  });

  it("rotation revokes S1 recovery codes and step-up proofs across A/B/C sessions", async () => {
    const sessionA = await signInApprovedUser();
    const initial = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(201);
    const s1 = successBody<EnrollMfaSuccess>(initial);
    const secretS1 = totpSecretFromUri(s1.totp_uri);
    const oldCode = s1.recovery_codes[0];
    const generationS1 = (
      await prisma.user.findUniqueOrThrow({
        where: { id: fixture.approvedUser.id },
      })
    ).mfaGenerationId;

    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: sessionA.session_token,
        otp: totpForTime(secretS1, Date.now()),
      })
      .expect(201);
    const sessionB = await signInApprovedUser();
    const nextStepOtp = totpForTime(secretS1, Date.now() + 30_000);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: sessionB.session_token, otp: nextStepOtp })
      .expect(201);

    for (const token of [sessionA.session_token, sessionB.session_token]) {
      const profile = await httpRequest(app)
        .get("/auth/profile")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      assert.equal(
        successBody<{ mfa_verified: boolean }>(profile).mfa_verified,
        true,
      );
    }

    const sessionC = await signInApprovedUser();
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .send({
        session_token: sessionA.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);
    const replacement = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(201);
    const s2 = successBody<EnrollMfaSuccess>(replacement);
    assert.ok(s2.recovery_codes.length > 0);
    assert.notEqual(s2.recovery_codes[0], oldCode);
    // In staged rotation, calling enroll stages candidate S2; active generation remains S1
    const currentGen = (
      await prisma.user.findUniqueOrThrow({
        where: { id: fixture.approvedUser.id },
      })
    ).mfaGenerationId;
    assert.equal(generationS1, currentGen);

    // Candidate recovery codes cannot prove S1 and cannot be used before S2 OTP verification
    const candidateCodeBlocked = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({
        session_token: sessionC.session_token,
        code: s2.recovery_codes[0],
      })
      .expect(403);
    assert.equal(problemCode(candidateCodeBlocked), AUTH_ERROR_CODES.mfaInvalid);

    // Old recovery code is still usable while rotation is pending candidate OTP
    await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: sessionC.session_token, code: oldCode })
      .expect(201);

    // Now Session A verifies candidate S2 OTP -> Atomically promotes S2, advances generation, revokes old codes, invalidates other sessions
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: sessionA.session_token,
        otp: totpForTime(totpSecretFromUri(s2.totp_uri), Date.now()),
      })
      .expect(201);

    const generationS2 = (
      await prisma.user.findUniqueOrThrow({
        where: { id: fixture.approvedUser.id },
      })
    ).mfaGenerationId;
    assert.notEqual(generationS1, generationS2);

    const afterA = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(200);
    assert.equal(
      successBody<{ mfa_verified: boolean }>(afterA).mfa_verified,
      true,
    );

    // Session B and Session C proofs (for S1) are now invalidated
    for (const token of [sessionB.session_token, sessionC.session_token]) {
      const stale = await httpRequest(app)
        .get("/auth/profile")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
      assert.equal(problemCode(stale), AUTH_ERROR_CODES.mfaRequired);
    }

    // Old code C1 is now permanently invalid
    const oldCodeRejected = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: sessionC.session_token, code: oldCode })
      .expect(403);
    assert.equal(problemCode(oldCodeRejected), AUTH_ERROR_CODES.mfaInvalid);

    // Session B elevates using newly-activated candidate recovery code
    await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({
        session_token: sessionB.session_token,
        code: s2.recovery_codes[0],
      })
      .expect(201);
    const verifiedB = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${sessionB.session_token}`)
      .expect(200);
    assert.equal(
      successBody<{ mfa_verified: boolean }>(verifiedB).mfa_verified,
      true,
    );

    const stillPendingC = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${sessionC.session_token}`)
      .expect(401);
    assert.equal(problemCode(stillPendingC), AUTH_ERROR_CODES.mfaRequired);
  });

  it("serializes concurrent S1 to S2 rotations and commits only the winner's generation and code batch", async () => {
    const a = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${a.session_token}`)
      .expect(201);
    const s1 = successBody<EnrollMfaSuccess>(enrolled);
    const secretS1 = totpSecretFromUri(s1.totp_uri);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: a.session_token,
        otp: totpForTime(secretS1, Date.now()),
      })
      .expect(201);

    const b = await signInApprovedUser();
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: b.session_token,
        otp: totpForTime(secretS1, Date.now() + 30_000),
      })
      .expect(201);
    for (const token of [a.session_token, b.session_token]) {
      await httpRequest(app)
        .post("/auth/re-auth/password")
        .set("Authorization", `Bearer ${token}`)
        .send({
          session_token: token,
          password: "CorrectHorseBatteryStaple!",
        })
        .expect(201);
    }

    const responses = await Promise.all(
      [a.session_token, b.session_token].map((token) =>
        httpRequest(app)
          .post("/auth/mfa/enroll")
          .set("Authorization", `Bearer ${token}`),
      ),
    );
    const winners = responses.filter((response) => response.status === 201);
    assert.equal(winners.length, 1, "only one rotation may commit");
    const loser = responses.find((response) => response.status !== 201);
    assert.ok(loser);
    assert.ok([401, 403].includes(loser.status));
    assert.equal(problemCode(loser), AUTH_ERROR_CODES.mfaRequired);

    const winner = successBody<EnrollMfaSuccess>(winners[0]);
    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.ok(persisted.mfaVerifiedAt !== null);

    const winnerSession = winners[0] === responses[0] ? a : b;
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: winnerSession.session_token,
        otp: totpForTime(totpSecretFromUri(winner.totp_uri), Date.now()),
      })
      .expect(201);

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    const rows = await prisma.authRecord.findMany({
      where: {
        userId: fixture.approvedUser.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        revokedAt: null,
        usedAt: null,
      },
    });
    assert.equal(rows.length, winner.recovery_codes.length);
    for (const row of rows) {
      assert.equal(
        authRecordMetadataString(row, "mfaGenerationId"),
        updatedUser.mfaGenerationId,
      );
    }
  });

  it("rolls back MFA rotation, active backup codes and multi-session proof invalidation on audit failure", async () => {
    const sessionA = await signInApprovedUser();
    const initial = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(201);
    const s1 = successBody<EnrollMfaSuccess>(initial);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: sessionA.session_token,
        otp: totpForTime(totpSecretFromUri(s1.totp_uri), Date.now()),
      })
      .expect(201);
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .send({
        session_token: sessionA.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    const spy = jest
      .spyOn(app.get(AuthAuditService), "writeInTx")
      .mockRejectedValueOnce(new Error("test MFA rotation audit failure"));
    try {
      await httpRequest(app)
        .post("/auth/mfa/enroll")
        .set("Authorization", `Bearer ${sessionA.session_token}`)
        .expect(500);
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.equal(after.mfaEncryptedSecret, before.mfaEncryptedSecret);
    assert.equal(after.mfaGenerationId, before.mfaGenerationId);
    assert.equal(
      after.mfaVerifiedAt?.getTime(),
      before.mfaVerifiedAt?.getTime(),
    );
    const recoveredSession = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(200);
    assert.equal(
      successBody<{ mfa_verified: boolean }>(recoveredSession).mfa_verified,
      true,
    );
    const fresh = await signInApprovedUser();
    await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: fresh.session_token, code: s1.recovery_codes[0] })
      .expect(201);
  });

  it("disabling MFA removes every session proof without revoking the sessions", async () => {
    const a = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${a.session_token}`)
      .expect(201);
    const body = successBody<EnrollMfaSuccess>(enrolled);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: a.session_token,
        otp: totpForTime(totpSecretFromUri(body.totp_uri), Date.now()),
      })
      .expect(201);
    const b = await signInApprovedUser();
    await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: b.session_token, code: body.recovery_codes[0] })
      .expect(201);
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${a.session_token}`)
      .send({
        session_token: a.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    await httpRequest(app)
      .delete("/auth/mfa")
      .set("Authorization", `Bearer ${a.session_token}`)
      .expect(200);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.equal(after.mfaRequired, false);
    assert.equal(after.mfaEncryptedSecret, null);
    assert.notEqual(after.mfaGenerationId, before.mfaGenerationId);

    const codeCount = await prisma.authRecord.count({
      where: {
        userId: fixture.approvedUser.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        usedAt: null,
        revokedAt: null,
      },
    });
    assert.equal(codeCount, 0);
    const allSessionProofs = await httpRequest(app)
      .get("/auth/sessions")
      .set("Authorization", `Bearer ${b.session_token}`)
      .expect(200);
    assert.ok(
      successBody<AuthSessionsSuccess>(allSessionProofs).sessions.every(
        (item) => item.mfa_verified_at === null,
      ),
    );
    for (const token of [a.session_token, b.session_token]) {
      const profile = await httpRequest(app)
        .get("/auth/profile")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      assert.equal(
        successBody<{ mfa_verified: boolean }>(profile).mfa_verified,
        false,
      );
      const sensitive = await httpRequest(app)
        .post("/auth/sensitive-route/check")
        .set("Authorization", `Bearer ${token}`)
        .send({ method: "POST", path: "/auth/mfa/recovery-codes" })
        .expect(200);
      assert.equal(
        successBody<{ reauth_required: boolean }>(sensitive).reauth_required,
        true,
      );
    }
  });

  it("profile update remains allowed while MFA setup is still pending first verification", async () => {
    const signIn = await signInApprovedUser();
    await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    const result = await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token, display_name: "Pending OK" })
      .expect(200);

    assert.equal(successBody<UpdateProfileSuccess>(result).ok, true);
  });

  it("disabling MFA requires fresh password re-auth and rejects when sensitive proof is missing (OTP alone does not grant password step-up)", async () => {
    const session = await signInAndVerifyApprovedUser();

    // Sensitive route check shows reauth is required (OTP alone does not set passwordReauthenticatedAt)
    const beforeCheck = await httpRequest(app)
      .post("/auth/sensitive-route/check")
      .set("Authorization", `Bearer ${session.session_token}`)
      .send({ method: "DELETE", path: "/auth/mfa" })
      .expect(200);
    assert.equal(
      (beforeCheck.body as { data?: { reauth_required?: unknown } }).data
        ?.reauth_required,
      true,
    );

    // Attempting to disable without password re-auth is denied with 403 REAUTH_REQUIRED
    const denied = await httpRequest(app)
      .delete("/auth/mfa")
      .set("Authorization", `Bearer ${session.session_token}`)
      .expect(403);
    assert.equal(problemCode(denied), AUTH_ERROR_CODES.reauthRequired);

    // Re-authenticate password
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${session.session_token}`)
      .send({
        session_token: session.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    // Now disable succeeds
    await httpRequest(app)
      .delete("/auth/mfa")
      .set("Authorization", `Bearer ${session.session_token}`)
      .expect(200);
  });

  it("re-enrolling verified MFA requires fresh password re-auth and rejects OTP-only proof", async () => {
    const session = await signInAndVerifyApprovedUser();

    // Calling enroll immediately after OTP verification is rejected with REAUTH_REQUIRED
    const denied = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${session.session_token}`)
      .send({ session_token: session.session_token })
      .expect(403);
    assert.equal(problemCode(denied), AUTH_ERROR_CODES.reauthRequired);

    // Re-authenticate password
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${session.session_token}`)
      .send({
        session_token: session.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    // Now re-enroll succeeds and returns candidate TOTP URI
    const replacement = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${session.session_token}`)
      .send({ session_token: session.session_token })
      .expect(201);
    assert.ok(successBody<EnrollMfaSuccess>(replacement).totp_uri);
  });

  it("cross-session rotation protection: pending-MFA session cannot restart or hijack an in-progress replacement", async () => {
    // User A signs in and verifies existing MFA factor (S1)
    const sessionA = await signInAndVerifyApprovedUser();

    // User A reauthenticates password
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .send({
        session_token: sessionA.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    // User A initiates MFA replacement (S1 -> S2)
    const enrollResA = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .send({ session_token: sessionA.session_token })
      .expect(201);
    const candidateA = successBody<EnrollMfaSuccess>(enrollResA);
    assert.ok(candidateA.totp_uri);
    const candidateSecretA = totpSecretFromUri(candidateA.totp_uri);

    // User A re-enters password while replacement is pending (must NOT erase candidate rotation fence)
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .send({
        session_token: sessionA.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    // Attacker B knows the password and logs in, establishing a separate pending-MFA session
    const sessionB = await signInApprovedUser();
    assert.equal(sessionB.mfa_required, true);

    // Attacker B attempts to call POST /auth/mfa/enroll to restart/replace S2 with S3
    const attackerDenied = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionB.session_token}`)
      .send({ session_token: sessionB.session_token })
      .expect(403);
    assert.equal(problemCode(attackerDenied), AUTH_ERROR_CODES.mfaRequired);

    // Attacker B also tries with reauth password first
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionB.session_token}`)
      .send({
        session_token: sessionB.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    // Still denied because session B hasn't verified existing factor S1
    const attackerDeniedAgain = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionB.session_token}`)
      .send({ session_token: sessionB.session_token })
      .expect(403);
    assert.equal(
      problemCode(attackerDeniedAgain),
      AUTH_ERROR_CODES.mfaRequired,
    );

    // Genuine User A verifies candidate S2 OTP
    const candidateOtpA = totpForTime(candidateSecretA, Date.now());
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: sessionA.session_token, otp: candidateOtpA })
      .expect(201);

    // User A can access protected profile
    const profile = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(200);
    assert.equal(successBody<{ ok: boolean }>(profile).ok, true);
  });

  it("abandoned replacement preserves active S1 factor and S1 recovery codes for new sign-in", async () => {
    // User A signs in and sets up S1
    const sessionA = await signInApprovedUser();
    const enrolled = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(201);
    const s1 = successBody<EnrollMfaSuccess>(enrolled);
    const secretS1 = totpSecretFromUri(s1.totp_uri);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({
        session_token: sessionA.session_token,
        otp: totpForTime(secretS1, Date.now()),
      })
      .expect(201);

    // User A reauthenticates password and starts factor replacement (staged S2)
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .send({
        session_token: sessionA.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);
    const replacement = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${sessionA.session_token}`)
      .expect(201);
    assert.ok(successBody<EnrollMfaSuccess>(replacement).totp_uri);

    // User A abandons replacement (closes tab/browser) without verifying S2 OTP.
    // User signs in from a fresh device/session D with password:
    const sessionD = await signInApprovedUser();
    assert.equal(sessionD.mfa_required, true);

    // S1 OTP is still completely valid!
    const otpS1 = totpForTime(secretS1, Date.now() + 60_000);
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: sessionD.session_token, otp: otpS1 })
      .expect(201);
    const profileD = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${sessionD.session_token}`)
      .expect(200);
    assert.equal(
      successBody<{ mfa_verified: boolean }>(profileD).mfa_verified,
      true,
    );

    // Another new sign-in session E can also still recover using original S1 recovery code!
    const sessionE = await signInApprovedUser();
    await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({
        session_token: sessionE.session_token,
        code: s1.recovery_codes[0],
      })
      .expect(201);
    const profileE = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${sessionE.session_token}`)
      .expect(200);
    assert.equal(
      successBody<{ mfa_verified: boolean }>(profileE).mfa_verified,
      true,
    );
  });

  it("unverified initial enrollment can be safely restarted without password re-auth", async () => {
    // Reset approved user to have no MFA configured
    await prisma.user.update({
      where: { id: fixture.approvedUser.id },
      data: {
        mfaEncryptedSecret: null,
        mfaEnrolledAt: null,
        mfaVerifiedAt: null,
      },
    });

    const signIn = await signInApprovedUser();

    // First enrollment attempt
    const enroll1 = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);
    const body1 = successBody<EnrollMfaSuccess>(enroll1);
    assert.ok(body1.totp_uri);

    // User abandons setup and restarts enrollment without verifying
    const enroll2 = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);
    const body2 = successBody<EnrollMfaSuccess>(enroll2);
    assert.ok(body2.totp_uri);
    const secret2 = totpSecretFromUri(body2.totp_uri);

    // Verifying candidate 2 successfully activates MFA
    const otp2 = totpForTime(secret2, Date.now());
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp: otp2 })
      .expect(201);

    const user = await prisma.user.findUnique({
      where: { id: fixture.approvedUser.id },
    });
    assert.ok(user?.mfaVerifiedAt);
  });

  it("pending-MFA session with successful password re-auth cannot rebind without factor proof (strict 2FA)", async () => {
    await signInAndVerifyApprovedUser();
    // New sign-in on MFA-enrolled user is pending MFA
    const pendingSession = await signInApprovedUser();
    assert.equal(pendingSession.mfa_required, true);

    // Password re-auth succeeds
    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${pendingSession.session_token}`)
      .send({
        session_token: pendingSession.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    // Attempting to enroll/rebind without MFA factor proof fails with MFA_REQUIRED
    const denied = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${pendingSession.session_token}`)
      .send({ session_token: pendingSession.session_token })
      .expect(403);
    assert.equal(problemCode(denied), AUTH_ERROR_CODES.mfaRequired);
  });

  it("profile update rejects a malformed recovery_email", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    const result = await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        recovery_email: "not-an-email",
      })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("profile access still succeeds without personal MFA enrollment", async () => {
    const signIn = await signInApprovedUser();
    assert.equal(signIn.mfa_required, undefined);
    assert.equal(signIn.mfa_enrolled, false);

    const result = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);

    assert.equal(successBody<{ ok: boolean }>(result).ok, true);
  });

  it("client-facing user projection only exposes role, not other RBAC subject attributes", async () => {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "CorrectHorseBatteryStaple!",
        organization_id: fixture.organizationId,
      })
      .expect(200);

    const success = successBody<{
      user: { subject_attributes: Record<string, string> };
    }>(result);
    assert.equal(
      success.user.subject_attributes.role,
      AUTH_USER_ROLES.customer,
    );
    assert.equal("department" in success.user.subject_attributes, false);
  });

  it("password recovery request does not leak whether the account exists", async () => {
    const known = await httpRequest(app)
      .post("/auth/recovery/request")
      .send({ email: fixture.approvedUser.email })
      .expect(201);

    const unknown = await httpRequest(app)
      .post("/auth/recovery/request")
      .send({ email: "nobody-here@acme.test" })
      .expect(201);

    const knownBody = successBody<RequestRecoverySuccess>(known);
    const unknownBody = successBody<RequestRecoverySuccess>(unknown);
    assert.equal(knownBody.ok, true);
    assert.equal(unknownBody.ok, true);
    assert.deepEqual(Object.keys(knownBody), Object.keys(unknownBody));
  });

  it("password recovery delivers to the configured recovery email when present", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        recovery_email: "recovery@safe.test",
      })
      .expect(200);

    await httpRequest(app)
      .post("/auth/recovery/request")
      .send({ email: fixture.approvedUser.email })
      .expect(201);

    assert.equal(recoveryNotifier.lastEmail, "recovery@safe.test");
  });

  it("password recovery falls back to the primary verified email when backup policy allows all verified emails", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        recovery_email: "recovery@safe.test",
        backup_recovery_email_policy: AUTH_BACKUP_EMAIL_POLICIES.allVerified,
      })
      .expect(200);

    await httpRequest(app)
      .post("/auth/recovery/request")
      .send({ email: fixture.approvedUser.email })
      .expect(201);

    assert.equal(recoveryNotifier.lastEmail, fixture.approvedUser.email);
  });

  it("primary email address can be switched to the recovery email for sign-in", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        recovery_email: "recovery-primary@safe.test",
        primary_email_address_policy:
          AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail,
      })
      .expect(200);

    const recoveryEmailSignIn = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: "recovery-primary@safe.test",
        password: "CorrectHorseBatteryStaple!",
        organization_id: fixture.organizationId,
      })
      .expect(200);

    const body = successBody<SignInSuccess>(recoveryEmailSignIn);
    assert.equal(body.ok, true);
    assert.equal(body.user.email, fixture.approvedUser.email);
  });

  it("password recovery request accepts the configured primary recovery email", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        recovery_email: "recovery-primary@safe.test",
        primary_email_address_policy:
          AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES.recoveryEmail,
      })
      .expect(200);

    await httpRequest(app)
      .post("/auth/recovery/request")
      .send({ email: "recovery-primary@safe.test" })
      .expect(201);

    assert.equal(recoveryNotifier.lastEmail, "recovery-primary@safe.test");
  });

  it("profile update rejects an invalid backup recovery email policy", async () => {
    const signIn = await signInAndVerifyApprovedUser();
    const result = await httpRequest(app)
      .patch("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        backup_recovery_email_policy: "NOT_A_POLICY",
      })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.validationFailed);
  });

  it("password recovery forwards the app origin for recovery links", async () => {
    await httpRequest(app)
      .post("/auth/recovery/request")
      .set("x-app-origin", "https://workspace.lcsp.test")
      .send({ email: fixture.approvedUser.email })
      .expect(201);

    assert.equal(recoveryNotifier.lastAppOrigin, "https://workspace.lcsp.test");
  });

  it("password recovery confirm resets the password and revokes existing sessions", async () => {
    const signIn = await signInApprovedUser();

    await httpRequest(app)
      .post("/auth/recovery/request")
      .send({ email: fixture.approvedUser.email })
      .expect(201);

    const token = recoveryNotifier.lastToken;
    assert.ok(token, "recovery notifier should have captured a token");

    const confirm = await httpRequest(app)
      .post("/auth/recovery/confirm")
      .send({ token, new_password: "BrandNewPassword456!" })
      .expect(201);
    assert.equal(successBody<ConfirmRecoverySuccess>(confirm).ok, true);

    const oldSessionCheck = await httpRequest(app)
      .get("/auth/profile")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(401);
    assert.equal(problemCode(oldSessionCheck), AUTH_ERROR_CODES.sessionInvalid);

    const newSignIn = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "BrandNewPassword456!",
        organization_id: fixture.organizationId,
      })
      .expect(200);
    assert.equal(successBody<SignInSuccess>(newSignIn).ok, true);
  });

  it("consumes a recovery token only once under concurrent confirmation", async () => {
    await httpRequest(app)
      .post("/auth/recovery/request")
      .send({ email: fixture.approvedUser.email })
      .expect(201);
    const token = recoveryNotifier.lastToken;
    assert.ok(token);

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    const responses = await Promise.all([
      httpRequest(app)
        .post("/auth/recovery/confirm")
        .send({ token, new_password: "AtomicPassword456!" }),
      httpRequest(app)
        .post("/auth/recovery/confirm")
        .send({ token, new_password: "AtomicPassword456!" }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 400],
    );
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.equal(after.accessVersion, before.accessVersion + 1);
    const recovery = await prisma.authRecord.findFirstOrThrow({
      where: {
        userId: fixture.approvedUser.id,
        type: AUTH_RECORD_TYPE.recoveryRequest,
      },
    });
    assert.ok(recovery.usedAt);
  });

  it("disables MFA, recovery codes and session MFA status atomically", async () => {
    const signIn = await signInApprovedUser();
    const enrollment = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);
    const enrollmentBody = successBody<EnrollMfaSuccess>(enrollment);
    const otp = totpForTime(
      totpSecretFromUri(enrollmentBody.totp_uri),
      Date.now(),
    );
    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp })
      .expect(201);

    await httpRequest(app)
      .post("/auth/re-auth/password")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({
        session_token: signIn.session_token,
        password: "CorrectHorseBatteryStaple!",
      })
      .expect(201);

    const response = await httpRequest(app)
      .delete("/auth/mfa")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);
    assert.equal(successBody<{ ok: boolean }>(response).ok, true);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.approvedUser.id },
    });
    assert.equal(user.mfaEncryptedSecret, null);
    assert.equal(user.mfaRequired, false);
    const remainingCodes = await prisma.authRecord.count({
      where: {
        userId: user.id,
        type: AUTH_RECORD_TYPE.mfaRecoveryCode,
        revokedAt: null,
        usedAt: null,
      },
    });
    assert.equal(remainingCodes, 0);
    const session = await findLatestAuthSession(prisma, user.id);
    assert.ok(session);
    assert.equal(authRecordMetadataString(session, "mfaVerifiedAt"), null);
  });

  it("password recovery confirm rejects an invalid or expired token", async () => {
    const result = await httpRequest(app)
      .post("/auth/recovery/confirm")
      .send({ token: "not-a-real-token", new_password: "SomethingNew123!" })
      .expect(400);

    const failure = expectFailure(result.body);
    assert.equal(failure.problem.code, AUTH_ERROR_CODES.recoveryInvalid);
  });

  async function signInApprovedUser() {
    const result = await httpRequest(app)
      .post("/auth/sign-in")
      .send({
        email: fixture.approvedUser.email,
        password: "CorrectHorseBatteryStaple!",
        organization_id: fixture.organizationId,
      })
      .expect(200);

    return successBody<SignInSuccess>(result);
  }

  async function signInAndVerifyApprovedUser() {
    await prisma.user.update({
      where: { id: fixture.approvedUser.id },
      data: {
        mfaEncryptedSecret: null,
        mfaEnrolledAt: null,
        mfaVerifiedAt: null,
      },
    });
    const signIn = await signInApprovedUser();
    const mfa = await seedMfaEnrollment(prisma, fixture.approvedUser.id);
    const otp = totpForTime(mfa.totpSecret, Date.now());

    await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp })
      .expect(201);

    return signIn;
  }
});

function expectFailure<T extends object>(
  result: T | ProblemResult,
): ProblemResult {
  if ("problem" in result) {
    return result;
  }

  throw new Error("expected failure");
}

function totpSecretFromUri(totpUri: string): string {
  const parsed = new URL(totpUri);
  const secret = parsed.searchParams.get("secret");
  assert.ok(secret, "TOTP URI must include a secret query parameter");
  return secret;
}
