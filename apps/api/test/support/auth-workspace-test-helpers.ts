import { PBAC_STATE_GATES, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  AUTH_INVITATION_STATES,
  AUTH_MEMBERSHIP_STATUSES,
} from "@lcsp/contracts/auth";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import {
  encryptMfaSecret,
  fingerprintToken,
  generateTotpSecret,
  hashSecret,
  totpForTime,
} from "../../src/modules/auth-workspace/infrastructure/security/security.utils.js";

const testSupportDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(testSupportDir, "../..");

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:55432/lcsp_api_test?schema=public";

export type AuthFixture = {
  organizationId: string;
  approvedUser: { id: string; email: string };
  unverifiedUser: { id: string; email: string };
  noMembershipUser: { id: string; email: string };
};

export function ensureTestMfaEncryptionKey(): void {
  process.env.MFA_ENCRYPTION_KEY ??=
    "test-only-mfa-encryption-key-do-not-use-in-prod";
}

export type MfaFixture = {
  userId: string;
  totpSecret: string;
};

export { generateTotpSecret, encryptMfaSecret, totpForTime };

export class CapturingRecoveryNotifier {
  public lastToken: string | null = null;
  public lastEmail: string | null = null;
  public lastAppOrigin: string | null = null;

  notify(input: {
    userId: string;
    email: string;
    token: string;
    correlationId: string;
    appOrigin?: string;
  }): Promise<void> {
    void input.userId;
    void input.correlationId;
    this.lastToken = input.token;
    this.lastEmail = input.email;
    this.lastAppOrigin = input.appOrigin ?? null;
    return Promise.resolve();
  }
}

export function pushPrismaSchema(): void {
  const cacheHome = resolve(apiRoot, ".cache");
  mkdirSync(cacheHome, { recursive: true });

  const prismaBinary =
    process.platform === "win32"
      ? resolve(apiRoot, "node_modules/.bin/prisma.cmd")
      : resolve(apiRoot, "node_modules/.bin/prisma");

  execFileSync(
    prismaBinary,
    ["db", "push", "--accept-data-loss", "--force-reset"],
    {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        XDG_CACHE_HOME: cacheHome,
      },
      stdio: "pipe",
      shell: process.platform === "win32",
    },
  );
}

export async function resetAuthWorkspaceDatabase(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.authDecisionLog.deleteMany();
  await prisma.authAuditEvent.deleteMany();
  await prisma.authRecoveryRequest.deleteMany();
  await prisma.authMfaOtpUsed.deleteMany();
  await prisma.authMfaRateLimit.deleteMany();
  await prisma.authUserMfa.deleteMany();
  await prisma.authOAuthState.deleteMany();
  await prisma.authOAuthIdentity.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.authInvitation.deleteMany();
  await prisma.authMembership.deleteMany();
  await prisma.authPolicy.deleteMany();
  await prisma.authUser.deleteMany();
  await prisma.authOrganization.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedMfaEnrollment(
  prisma: PrismaClient,
  userId: string,
): Promise<MfaFixture> {
  const totpSecret = generateTotpSecret();
  await prisma.authUserMfa.create({
    data: {
      userId,
      encryptedSecret: encryptMfaSecret(totpSecret),
      enrolledAt: new Date(),
    },
  });
  return { userId, totpSecret };
}

export async function seedAuthWorkspaceFixture(
  prisma: PrismaClient,
): Promise<AuthFixture> {
  const organizationId = "org-1";
  const approvedUserId = "user-1";
  const unverifiedUserId = "user-2";
  const noMembershipUserId = "user-3";
  const revokedMembershipUserId = "user-4";
  const policyId = "policy-manager-workspace";
  const policyVersion = "2026-06-26";

  await prisma.authOrganization.create({
    data: {
      id: organizationId,
      slug: "acme",
      name: "Acme Legal",
    },
  });

  await prisma.authUser.createMany({
    data: [
      {
        id: approvedUserId,
        email: "manager@acme.test",
        displayName: "Acme Manager",
        passwordHash: hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
      {
        id: unverifiedUserId,
        email: "pending@acme.test",
        passwordHash: hashSecret("VerifyMe123!"),
        emailVerified: false,
        failedLoginCount: 0,
      },
      {
        id: noMembershipUserId,
        email: "nomembership@acme.test",
        passwordHash: hashSecret("NoMembership123!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
      {
        id: revokedMembershipUserId,
        email: "revoked-member@acme.test",
        passwordHash: hashSecret("RevokedMembership123!"),
        emailVerified: true,
        failedLoginCount: 0,
      },
    ],
  });

  await prisma.authPolicy.create({
    data: {
      id: policyId,
      version: policyVersion,
      actions: [
        PBAC_ACTIONS.workspaceRead,
        PBAC_ACTIONS.assessmentCreate,
        PBAC_ACTIONS.assessmentRead,
        PBAC_ACTIONS.assessmentList,
        PBAC_ACTIONS.githubConnect,
        PBAC_ACTIONS.scanRead,
        PBAC_ACTIONS.scanTrigger,
        PBAC_ACTIONS.documentGenerate,
        PBAC_ACTIONS.snapshotCreate,
        PBAC_ACTIONS.wizardWrite,
        PBAC_ACTIONS.wizardSubmit,
        PBAC_ACTIONS.wizardExport,
      ],
      subjectRole: SUBJECT_ROLES.manager,
      stateGate: PBAC_STATE_GATES.membershipActive,
      organizationId,
    },
  });

  await prisma.authMembership.createMany({
    data: [
      {
        id: "membership-1",
        userId: approvedUserId,
        organizationId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager, department: "Legal" },
        policyId,
        policyVersion,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "membership-2",
        userId: unverifiedUserId,
        organizationId,
        status: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId,
        policyVersion,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "membership-3",
        userId: revokedMembershipUserId,
        organizationId,
        status: AUTH_MEMBERSHIP_STATUSES.revoked,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId,
        policyVersion,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  });

  await prisma.authInvitation.createMany({
    data: [
      {
        id: "invite-approved",
        email: "invitee@acme.test",
        organizationId,
        state: AUTH_INVITATION_STATES.approved,
        emailVerified: true,
        membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager, department: "Legal" },
        policyId,
        policyVersion,
        expiresAt: new Date(Date.now() + 72 * 60 * 60_000),
      },
      {
        id: "invite-pending",
        email: "hold@acme.test",
        organizationId,
        state: AUTH_INVITATION_STATES.pending,
        emailVerified: true,
        membershipStatus: AUTH_MEMBERSHIP_STATUSES.invited,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId,
        policyVersion,
        expiresAt: new Date(Date.now() + 72 * 60 * 60_000),
      },
      {
        id: "invite-unverified",
        email: "verify-later@acme.test",
        organizationId,
        state: AUTH_INVITATION_STATES.approved,
        emailVerified: false,
        membershipStatus: AUTH_MEMBERSHIP_STATUSES.active,
        subjectAttributes: { role: SUBJECT_ROLES.manager },
        policyId,
        policyVersion,
        expiresAt: new Date(Date.now() + 72 * 60 * 60_000),
      },
      {
        id: "invite-not-active",
        email: "inactive@acme.test",
        organizationId,
        state: AUTH_INVITATION_STATES.approved,
        emailVerified: true,
        membershipStatus: AUTH_MEMBERSHIP_STATUSES.invited,
        subjectAttributes: { role: SUBJECT_ROLES.developer },
        policyId,
        policyVersion,
        expiresAt: new Date(Date.now() + 72 * 60 * 60_000),
      },
    ],
  });

  const revokedSessionToken = "revoked-session-token";
  await prisma.authSession.create({
    data: {
      id: "session-0",
      userId: approvedUserId,
      organizationId,
      tokenHash: hashSecret(revokedSessionToken),
      tokenFingerprint: fingerprintToken(revokedSessionToken),
      expiresAt: new Date(Date.now() + 30 * 60_000),
      revokedAt: new Date(),
    },
  });

  return {
    organizationId,
    approvedUser: { id: approvedUserId, email: "manager@acme.test" },
    unverifiedUser: { id: unverifiedUserId, email: "pending@acme.test" },
    noMembershipUser: {
      id: noMembershipUserId,
      email: "nomembership@acme.test",
    },
  };
}
