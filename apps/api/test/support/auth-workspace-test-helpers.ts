import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  REPOSITORY_SNAPSHOT_STATUSES,
  type RepositoryScanJobStatus,
} from "@lcsp/contracts/github-integration";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EvidenceAcceptanceStatus,
  LegalRuleLifecycleStatus,
  PrismaClient,
  VerifiedProfileStatus,
} from "@prisma/client";

import {
  encryptMfaSecret,
  generateTotpSecret,
  hashSecret,
  totpForTime,
} from "../../src/modules/auth-workspace/infrastructure/security/security.utils.js";

import { createAuthSessionRecord } from "./auth-record-test-helpers.js";

const testSupportDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(testSupportDir, "../..");

const configuredTestDatabaseUrl =
  process.env.DATABASE_URL ?? process.env.PHASE25_DATABASE_URL;

if (!configuredTestDatabaseUrl) {
  throw new Error(
    "E2E/integration tests require an explicit disposable DATABASE_URL (or PHASE25_DATABASE_URL)",
  );
}

export const TEST_DATABASE_URL = configuredTestDatabaseUrl;

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

export type RepositorySnapshotGraphFixtureInput = {
  assessmentId?: string;
  organizationId?: string;
  userId?: string;
  connectionId?: string;
  snapshotId?: string;
  installationId?: string;
  repositoryId?: string;
};

export type RepositoryScanGraphFixtureInput =
  RepositorySnapshotGraphFixtureInput & {
    scanJobId?: string;
    scanJobStatus?: RepositoryScanJobStatus;
  };

export type VerifiedProfileGraphFixtureInput =
  RepositoryScanGraphFixtureInput & {
    evidenceReportId?: string;
    technicalProfileId?: string;
    aiUsageFlowId?: string;
    verifiedProfileId?: string;
  };

export type LegalClassificationParentsInput = {
  corpusVersionId?: string;
  catalogVersionId?: string;
};

async function ensureAuthUser(
  prisma: PrismaClient,
  input: {
    userId: string;
    email: string;
    role: (typeof AUTH_USER_ROLES)[keyof typeof AUTH_USER_ROLES];
    displayName?: string;
  },
): Promise<void> {
  await prisma.user.upsert({
    where: { id: input.userId },
    update: {
      emailVerified: true,
      failedLoginCount: 0,
      role: input.role,
      ...(input.displayName ? { displayName: input.displayName } : {}),
    },
    create: {
      id: input.userId,
      email: input.email,
      displayName: input.displayName,
      passwordHash: hashSecret("CorrectHorseBatteryStaple!"),
      emailVerified: true,
      failedLoginCount: 0,
      role: input.role,
    },
  });
}

async function ensureAssessment(
  prisma: PrismaClient,
  input: {
    assessmentId: string;
    ownerId: string;
    name?: string;
  },
): Promise<void> {
  await prisma.assessment.upsert({
    where: { id: input.assessmentId },
    update: {
      ownerId: input.ownerId,
      name: input.name ?? "Fixture assessment",
    },
    create: {
      id: input.assessmentId,
      ownerId: input.ownerId,
      name: input.name ?? "Fixture assessment",
    },
  });
}

export async function seedRepositorySnapshotGraph(
  prisma: PrismaClient,
  input: RepositorySnapshotGraphFixtureInput = {},
): Promise<void> {
  const assessmentId = input.assessmentId ?? "assessment-1";
  const userId = input.userId ?? "user-1";
  const connectionId = input.connectionId ?? "connection-1";
  const snapshotId = input.snapshotId ?? "snapshot-1";
  const installationId = input.installationId ?? `installation-${connectionId}`;
  const repositoryId = input.repositoryId ?? `repo-${connectionId}`;

  await ensureAuthUser(prisma, {
    userId,
    email: `${userId}@fixture.test`,
    displayName: "Fixture User",
    role: AUTH_USER_ROLES.customer,
  });
  await ensureAssessment(prisma, {
    assessmentId,
    ownerId: userId,
  });

  await prisma.repositoryConnection.upsert({
    where: { installationId_repositoryId: { installationId, repositoryId } },
    update: {
      assessmentId,
      userId,
      repositoryName: "example-repo",
      repositoryFullName: "acme/example-repo",
      defaultBranch: "main",
      permissions: { contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read },
      status: REPOSITORY_CONNECTION_STATUSES.active,
      revokedAt: null,
    },
    create: {
      id: connectionId,
      assessmentId,
      userId,
      installationId,
      repositoryId,
      repositoryName: "example-repo",
      repositoryFullName: "acme/example-repo",
      defaultBranch: "main",
      permissions: { contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read },
      status: REPOSITORY_CONNECTION_STATUSES.active,
    },
  });

  await prisma.repositorySnapshot.upsert({
    where: { id: snapshotId },
    update: {
      assessmentId,
      connectionId,
      repositoryId,
      repositoryFullName: "acme/example-repo",
      actorId: userId,
      status: REPOSITORY_SNAPSHOT_STATUSES.ready,
    },
    create: {
      id: snapshotId,
      assessmentId,
      connectionId,
      repositoryId,
      repositoryFullName: "acme/example-repo",
      branch: "main",
      ref: "refs/heads/main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      providerMetadata: { source: "e2e-fixture" },
      actorId: userId,
      status: REPOSITORY_SNAPSHOT_STATUSES.ready,
    },
  });
}

export async function seedRepositoryScanGraph(
  prisma: PrismaClient,
  input: RepositoryScanGraphFixtureInput = {},
): Promise<void> {
  const scanJobId = input.scanJobId ?? "scan-job-1";
  const assessmentId = input.assessmentId ?? "assessment-1";
  const snapshotId = input.snapshotId ?? "snapshot-1";

  await seedRepositorySnapshotGraph(prisma, input);

  await prisma.repositoryScanJob.upsert({
    where: { id: scanJobId },
    update: {
      assessmentId,
      snapshotId,
      status: input.scanJobStatus ?? REPOSITORY_SCAN_JOB_STATUSES.completed,
    },
    create: {
      id: scanJobId,
      assessmentId,
      snapshotId,
      idempotencyKey: `scan-request:${assessmentId}:${snapshotId}:${scanJobId}`,
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
      status: input.scanJobStatus ?? REPOSITORY_SCAN_JOB_STATUSES.completed,
      attemptCount: 1,
      correlationId: `corr-${scanJobId}`,
    },
  });
}

export async function seedVerifiedProfileGraph(
  prisma: PrismaClient,
  input: VerifiedProfileGraphFixtureInput = {},
): Promise<void> {
  const evidenceReportId = input.evidenceReportId ?? "evidence-report-1";
  const technicalProfileId = input.technicalProfileId ?? "technical-profile-1";
  const aiUsageFlowId = input.aiUsageFlowId ?? "ai-usage-flow-1";
  const verifiedProfileId = input.verifiedProfileId ?? "vp-1";
  const assessmentId = input.assessmentId ?? "assessment-1";
  const scanJobId = input.scanJobId ?? "scan-job-1";
  const snapshotId = input.snapshotId ?? "snapshot-1";

  await seedRepositoryScanGraph(prisma, {
    ...input,
    scanJobId,
    snapshotId,
  });
  await ensureAuthUser(prisma, {
    userId: input.userId ?? "user-1",
    email: `${input.userId ?? "user-1"}@fixture.test`,
    displayName: "Fixture User",
    role: AUTH_USER_ROLES.customer,
  });
  await ensureAssessment(prisma, {
    assessmentId,
    ownerId: input.userId ?? "user-1",
  });

  await prisma.technicalEvidenceReport.upsert({
    where: { id: evidenceReportId },
    update: {
      scanJobId,
      assessmentId,
      snapshotId,
      status: EvidenceAcceptanceStatus.ACCEPTED,
    },
    create: {
      id: evidenceReportId,
      scanJobId,
      assessmentId,
      snapshotId,
      toolsVersion: { semgrep: "1.0.0" },
      configHash: { semgrep: "sha256:test" },
      evidencePayload: { findings: [{ finding_id: "finding-1" }] },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      schemaVersion: "1.0.0",
      status: EvidenceAcceptanceStatus.ACCEPTED,
    },
  });

  await prisma.technicalProfile.upsert({
    where: { id: technicalProfileId },
    update: {
      evidenceReportId,
      assessmentId,
      status: EvidenceAcceptanceStatus.ACCEPTED,
    },
    create: {
      id: technicalProfileId,
      evidenceReportId,
      assessmentId,
      schemaVersion: "1.0.0",
      providerVersion: "technical-profile-worker@fixture",
      profileData: { aiDetected: "confirmed" },
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: EvidenceAcceptanceStatus.ACCEPTED,
    },
  });

  await prisma.aIUsageFlow.upsert({
    where: { id: aiUsageFlowId },
    update: {
      technicalProfileId,
      assessmentId,
      status: EvidenceAcceptanceStatus.ACCEPTED,
    },
    create: {
      id: aiUsageFlowId,
      technicalProfileId,
      assessmentId,
      schemaVersion: "1.0.0",
      providerVersion: "ai-usage-flow-worker@fixture",
      claims: [],
      unknownUsages: [],
      privacyFlags: { containsSourceCode: false, secretsRedacted: true },
      status: EvidenceAcceptanceStatus.ACCEPTED,
    },
  });

  await prisma.verifiedProfile.upsert({
    where: { id: verifiedProfileId },
    update: {
      aiUsageFlowId,
      technicalEvidenceReportId: evidenceReportId,
      assessmentId,
      status: VerifiedProfileStatus.APPROVED,
    },
    create: {
      id: verifiedProfileId,
      aiUsageFlowId,
      technicalEvidenceReportId: evidenceReportId,
      assessmentId,
      schemaVersion: "1.0.0",
      providerVersion: "reconciliation@fixture",
      profileData: { source: "e2e-fixture" },
      gatesPassedAt: { fixture: true },
      status: VerifiedProfileStatus.APPROVED,
      approvedAt: new Date("2026-08-25T00:00:00.000Z"),
      approvedById: input.userId ?? "user-1",
    },
  });
}

export async function seedLegalClassificationParents(
  prisma: PrismaClient,
  input: LegalClassificationParentsInput = {},
): Promise<void> {
  const corpusVersionId = input.corpusVersionId ?? "LCSP-LEGAL-CORPUS-v0.1.0";
  const catalogVersionId = input.catalogVersionId ?? "LCSP-RULE-CATALOG-v0.1.0";

  await prisma.legalCorpusVersion.upsert({
    where: { id: corpusVersionId },
    update: { status: LegalRuleLifecycleStatus.APPROVED },
    create: {
      id: corpusVersionId,
      version: corpusVersionId,
      status: LegalRuleLifecycleStatus.APPROVED,
      sourceManifest: { source: "e2e-fixture" },
      approvedAt: new Date("2026-08-25T00:00:00.000Z"),
    },
  });

  await prisma.legalRuleCatalogVersion.upsert({
    where: { id: catalogVersionId },
    update: { status: LegalRuleLifecycleStatus.APPROVED },
    create: {
      id: catalogVersionId,
      version: catalogVersionId,
      status: LegalRuleLifecycleStatus.APPROVED,
      ruleRefs: [],
      approvedAt: new Date("2026-08-25T00:00:00.000Z"),
    },
  });
}

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
  await prisma.conflictRecord.deleteMany();
  await prisma.verifiedProfile.deleteMany();
  await prisma.aIUsageFlow.deleteMany();
  await prisma.wizardProfile.deleteMany();
  await prisma.technicalProfile.deleteMany();
  await prisma.technicalEvidenceReport.deleteMany();
  await prisma.repositoryScanJob.deleteMany();
  await prisma.repositorySnapshot.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.documentRequest.deleteMany();
  await prisma.classificationResult.deleteMany();
  await prisma.legalRuleMatch.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.authRecord.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedMfaEnrollment(
  prisma: PrismaClient,
  userId: string,
): Promise<MfaFixture> {
  const totpSecret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: {
      mfaEncryptedSecret: encryptMfaSecret(totpSecret),
      mfaEnrolledAt: new Date(),
      mfaVerifiedAt: null,
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

  await prisma.user.createMany({
    data: [
      {
        id: approvedUserId,
        email: "manager@acme.test",
        displayName: "Acme Manager",
        passwordHash: hashSecret("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
      {
        id: unverifiedUserId,
        email: "pending@acme.test",
        passwordHash: hashSecret("VerifyMe123!"),
        emailVerified: false,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
      {
        id: noMembershipUserId,
        email: "nomembership@acme.test",
        passwordHash: hashSecret("NoMembership123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.admin,
      },
      {
        id: revokedMembershipUserId,
        email: "revoked-member@acme.test",
        passwordHash: hashSecret("RevokedMembership123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.admin,
      },
    ],
  });

  const revokedSessionToken = "revoked-session-token";
  await createAuthSessionRecord(prisma, {
    id: "session-0",
    userId: approvedUserId,
    token: revokedSessionToken,
    expiresAt: new Date(Date.now() + 30 * 60_000),
    revokedAt: new Date(),
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
