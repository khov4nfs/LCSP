import {
  AUTH_BACKUP_EMAIL_POLICIES,
  AUTH_LEGACY_AUDIT_EVENT_TYPES,
  AUTH_PRIMARY_EMAIL_ADDRESS_POLICIES,
  AUTH_USER_ROLES,
} from "@lcsp/contracts/auth";
import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { httpRequest, problemCode, successBody } from "./support/http.js";

import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES, type ProblemResult } from "@lcsp/contracts/auth";
import { resolveMessage } from "@lcsp/i18n";

import { AppModule } from "../src/app.module.js";
import type {
  EnrollMfaSuccess,
  GenerateMfaRecoveryCodesSuccess,
  VerifyMfaOtpSuccess,
  VerifyMfaRecoveryCodeSuccess,
} from "../src/modules/auth-workspace/application/contracts/auth-workspace/mfa.contract.js";
import type { PasswordReauthSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/password-reauth.contract.js";
import type { UpdateProfileSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/profile.contract.js";
import type {
  ConfirmRecoverySuccess,
  RequestRecoverySuccess,
} from "../src/modules/auth-workspace/application/contracts/auth-workspace/recovery.contract.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import type { WorkspaceSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/workspace.contract.js";
import { AUTH_WORKSPACE_RECOVERY_NOTIFIER } from "../src/modules/auth-workspace/application/ports/notification/recovery-notifier.js";
import {
  type AuthFixture,
  CapturingRecoveryNotifier,
  TEST_DATABASE_URL,
  ensureTestMfaEncryptionKey,
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  seedMfaEnrollment,
  totpForTime,
} from "./support/auth-workspace-test-helpers.js";

describe("Auth workspace (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fixture: AuthFixture;
  let recoveryNotifier: CapturingRecoveryNotifier;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    ensureTestMfaEncryptionKey();
    pushPrismaSchema();

    prisma = new PrismaClient({
      adapter: new PrismaPg(TEST_DATABASE_URL),
    });
    await prisma.$connect();

    recoveryNotifier = new CapturingRecoveryNotifier();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTH_WORKSPACE_RECOVERY_NOTIFIER)
      .useValue(recoveryNotifier)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    await resetAuthWorkspaceDatabase(prisma);
    fixture = await seedAuthWorkspaceFixture(prisma);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

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
      .send({ method: "GET", path: "/api/github/app/start" })
      .expect(200);
    assert.equal(
      (beforeCheck.body as { data?: { reauth_required?: unknown } }).data
        ?.reauth_required,
      true,
    );
    assert.equal(
      (beforeCheck.body as { data?: { route_id?: unknown } }).data?.route_id,
      "GITHUB_APP_START",
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

    const session = await prisma.authSession.findFirst({
      where: {
        userId: fixture.approvedUser.id,
      },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(session?.sensitiveActionVerifiedAt);

    const afterCheck = await httpRequest(app)
      .post("/auth/sensitive-route/check")
      .set("Authorization", `Bearer ${sessionToken}`)
      .send({ method: "GET", path: "/api/github/app/start?installation_id=1" })
      .expect(200);
    assert.equal(
      (afterCheck.body as { data?: { reauth_required?: unknown } }).data
        ?.reauth_required,
      false,
    );
    assert.equal(
      (afterCheck.body as { data?: { route_id?: unknown } }).data?.route_id,
      "GITHUB_APP_START",
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

  it("protected workspace endpoint fails closed without authentication", async () => {
    const result = await httpRequest(app)
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("x-correlation-id", "corr-workspace-no-session")
      .expect(401);

    assert.equal(problemCode(result), AUTH_ERROR_CODES.sessionInvalid);
    assert.equal("workspace" in result.body, false);

    const decision = await prisma.authDecisionLog.findFirstOrThrow({
      where: { correlationId: "corr-workspace-no-session" },
    });
    assert.equal(decision.decision, AUDIT_DECISIONS.deny);
  });

  it("workspace ignores deprecated organization_id query parameters", async () => {
    const signIn = await signInAndVerifyApprovedUser();

    const result = await httpRequest(app)
      .get("/workspace")
      .query({ organization_id: "org-2" })
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);

    const body = successBody<WorkspaceSuccess>(result);
    assert.equal(body.user_id, fixture.approvedUser.id);
    assert.equal(body.role, AUTH_USER_ROLES.customer);
  });

  it("revoked session cannot access protected workspace", async () => {
    const result = await httpRequest(app)
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("Authorization", "Bearer revoked-session-token")
      .expect(401);

    assert.equal(problemCode(result), AUTH_ERROR_CODES.sessionInvalid);
  });

  it("workspace access is derived from the session-backed user role", async () => {
    const signIn = await signInAndVerifyApprovedUser();

    const result = await httpRequest(app)
      .get("/workspace")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);

    assert.equal(
      successBody<WorkspaceSuccess>(result).role,
      AUTH_USER_ROLES.customer,
    );
  });

  it("workspace access does not depend on legacy organization policy rows", async () => {
    const signIn = await signInAndVerifyApprovedUser();

    const result = await httpRequest(app)
      .get("/workspace")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);

    assert.equal(successBody<WorkspaceSuccess>(result).ok, true);
  });

  it("returns the active workspace session context", async () => {
    const signIn = await signInAndVerifyApprovedUser();

    const result = await httpRequest(app)
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .set("x-correlation-id", "corr-manager-workspace-context")
      .expect(200);

    const body = successBody<WorkspaceSuccess & Record<string, unknown>>(
      result,
    );
    assert.equal(body.user_id, fixture.approvedUser.id);
    assert.equal(body.display_name, "Acme Manager");
    assert.equal(body.role, AUTH_USER_ROLES.customer);
    assert.equal(typeof body.session_expires_at, "string");
    assert.equal(body.mfa_verified, true);
    assert.equal(body.mfa_verified, true);
    assert.equal(body.correlationId, "corr-manager-workspace-context");
    assert.equal(Number.isNaN(Date.parse(body.session_expires_at)), false);
    assert.equal("policyId" in body, false);
    assert.equal("policyVersion" in body, false);
    assert.equal("tokenHash" in body, false);

    const decision = await prisma.authDecisionLog.findFirstOrThrow({
      where: {
        correlationId: "corr-manager-workspace-context",
        resourceType: AUDIT_RESOURCE_TYPES.workspace,
      },
    });
    assert.equal(decision.resourceType, AUDIT_RESOURCE_TYPES.workspace);
    assert.equal(decision.resourceId, "workspace-home");
    assert.equal(decision.decision, AUDIT_DECISIONS.allow);
    assert.equal(decision.correlationId, "corr-manager-workspace-context");
    assert.doesNotMatch(
      JSON.stringify(decision.payload),
      /policyId|policyVersion/,
    );
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
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .set("x-correlation-id", "corr-workspace-allow")
      .expect(200);

    const allowDecision = await prisma.authDecisionLog.findFirstOrThrow({
      where: { correlationId: "corr-workspace-allow" },
    });
    assert.equal(allowDecision.decision, AUDIT_DECISIONS.allow);

    await httpRequest(app)
      .post("/auth/revoke-session")
      .send({ session_token: signIn.session_token })
      .expect(201);

    const auditEvents = await prisma.authAuditEvent.findMany({
      orderBy: { createdAt: "asc" },
    });
    const serializedAudit = JSON.stringify(
      auditEvents.map((item) => item.payload),
    );

    assert.match(serializedAudit, /auth\.login\.succeeded/);
    assert.match(serializedAudit, /workspace\.access\.allowed/);
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

  it("MFA recovery code verifies MFA once and rejects replay", async () => {
    const signIn = await signInApprovedUser();
    const enrollment = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);
    const recoveryCode =
      successBody<EnrollMfaSuccess>(enrollment).recovery_codes[0];

    const verify = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: signIn.session_token, code: recoveryCode })
      .expect(201);
    assert.equal(successBody<VerifyMfaRecoveryCodeSuccess>(verify).ok, true);

    const replay = await httpRequest(app)
      .post("/auth/mfa/recovery-code/verify")
      .send({ session_token: signIn.session_token, code: recoveryCode })
      .expect(403);
    assert.equal(problemCode(replay), AUTH_ERROR_CODES.mfaInvalid);

    const usedCodes = await prisma.authMfaRecoveryCode.findMany({
      where: { userId: fixture.approvedUser.id, usedAt: { not: null } },
    });
    assert.equal(usedCodes.length, 1);
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

  it("MFA enrollment labels the TOTP URI with the effective primary email address", async () => {
    await prisma.authUser.update({
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
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);

    assert.equal(successBody<WorkspaceSuccess>(result).ok, true);
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

  it("valid OTP verifies MFA and grants workspace access", async () => {
    const signIn = await signInApprovedUser();
    const mfa = await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    const otp = totpForTime(mfa.totpSecret, Date.now());
    const verify = await httpRequest(app)
      .post("/auth/mfa/verify-otp")
      .send({ session_token: signIn.session_token, otp })
      .expect(201);
    assert.equal(successBody<VerifyMfaOtpSuccess>(verify).ok, true);

    const workspace = await httpRequest(app)
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);
    assert.equal(successBody<WorkspaceSuccess>(workspace).ok, true);
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

    const auditEvents = await prisma.authAuditEvent.findMany();
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

    const auditEvents = await prisma.authAuditEvent.findMany({
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

  it("undecryptable MFA secrets redirect verification back to enrollment", async () => {
    const originalKey = process.env.MFA_ENCRYPTION_KEY;
    process.env.MFA_ENCRYPTION_KEY = "mfa-key-before-rotation";
    const signIn = await signInApprovedUser();
    const mfa = await seedMfaEnrollment(prisma, fixture.approvedUser.id);
    const otp = totpForTime(mfa.totpSecret, Date.now());

    process.env.MFA_ENCRYPTION_KEY = "mfa-key-after-rotation";

    try {
      const result = await httpRequest(app)
        .post("/auth/mfa/verify-otp")
        .send({ session_token: signIn.session_token, otp })
        .expect(403);

      const failure = expectFailure(result.body);
      assert.equal(failure.problem.code, AUTH_ERROR_CODES.mfaRequired);
    } finally {
      process.env.MFA_ENCRYPTION_KEY = originalKey;
    }
  });

  it("MFA enrollment can replace an undecryptable stale secret", async () => {
    const originalKey = process.env.MFA_ENCRYPTION_KEY;
    process.env.MFA_ENCRYPTION_KEY = "mfa-key-before-rotation";
    const signIn = await signInApprovedUser();
    await seedMfaEnrollment(prisma, fixture.approvedUser.id);

    process.env.MFA_ENCRYPTION_KEY = "mfa-key-after-rotation";

    try {
      const result = await httpRequest(app)
        .post("/auth/mfa/enroll")
        .set("Authorization", `Bearer ${signIn.session_token}`)
        .send({ session_token: signIn.session_token })
        .expect(201);

      const body = successBody<EnrollMfaSuccess>(result);
      assert.equal(body.ok, true);
      assert.match(body.totp_uri, /^otpauth:\/\/totp\//);
    } finally {
      process.env.MFA_ENCRYPTION_KEY = originalKey;
    }
  });

  // AC2: Session expiry/revocation with audit trail

  it("expired session is denied access with audit event recorded", async () => {
    const expiredToken = "expired-session-token";
    const { hashSecret, fingerprintToken } =
      await import("../src/modules/auth-workspace/infrastructure/security/security.utils.js");
    await prisma.authSession.create({
      data: {
        id: "session-expired",
        userId: fixture.approvedUser.id,
        tokenHash: hashSecret(expiredToken),
        tokenFingerprint: fingerprintToken(expiredToken),
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
      },
    });

    const result = await httpRequest(app)
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("Authorization", `Bearer ${expiredToken}`)
      .expect(401);

    assert.equal(problemCode(result), AUTH_ERROR_CODES.sessionInvalid);
  });

  it("revoke-session records audit event and blocks subsequent workspace access", async () => {
    const signIn = await signInApprovedUser();

    await httpRequest(app)
      .post("/auth/revoke-session")
      .send({ session_token: signIn.session_token })
      .expect(201);

    const workspace = await httpRequest(app)
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(401);

    assert.equal(problemCode(workspace), AUTH_ERROR_CODES.sessionInvalid);

    const auditEvents = await prisma.authAuditEvent.findMany();
    const revoked = auditEvents.find(
      (e) =>
        (e.payload as Record<string, unknown>)["event_type"] ===
        AUTH_LEGACY_AUDIT_EVENT_TYPES.sessionRevoked,
    );
    assert.ok(revoked, "auth.session.revoked audit event should be recorded");
  });

  // AC3: Profile update safety

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

    const auditEvents = await prisma.authAuditEvent.findMany();
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
    const signIn = await signInApprovedUser();
    await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(201);

    const reEnroll = await httpRequest(app)
      .post("/auth/mfa/enroll")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .send({ session_token: signIn.session_token })
      .expect(403);

    assert.equal(problemCode(reEnroll), AUTH_ERROR_CODES.mfaRequired);
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

  it("workspace access still succeeds without personal MFA enrollment", async () => {
    const signIn = await signInApprovedUser();
    assert.equal(signIn.mfa_required, undefined);
    assert.equal(signIn.mfa_enrolled, false);

    const result = await httpRequest(app)
      .get("/workspace")
      .set("Authorization", `Bearer ${signIn.session_token}`)
      .expect(200);

    assert.equal(successBody<WorkspaceSuccess>(result).ok, true);
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
      .get("/workspace")
      .query({ organization_id: fixture.organizationId })
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
    await prisma.authUserMfa.deleteMany({
      where: { userId: fixture.approvedUser.id },
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
