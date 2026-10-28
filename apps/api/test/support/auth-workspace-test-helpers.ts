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

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  encryptMfaSecret,
  generateTotpSecret,
  hashSecret,
  totpForTime,
} from "../../src/modules/auth/infrastructure/security/security.utils.js";

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
  rebuildPrismaSchema(["db", "push", "--accept-data-loss"]);
}

/**
 * `db push` drops migration-only DDL (deferrable FKs, triggers, CHECKs); a suite that needs it
 * restores the migrated schema when an earlier suite pushed the shared database.
 */
export async function ensureMigratedSchema(): Promise<void> {
  const db = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
  try {
    const [{ migrated }] = await db.$queryRaw<{ migrated: boolean }[]>`
      SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS migrated`;
    if (!migrated) rebuildPrismaSchema(["migrate", "deploy"]);
  } finally {
    await db.$disconnect();
  }
}

function rebuildPrismaSchema(build: string[]): void {
  const cacheHome = resolve(apiRoot, ".cache");
  mkdirSync(cacheHome, { recursive: true });

  const prismaBinary =
    process.platform === "win32"
      ? resolve(apiRoot, "node_modules/.bin/prisma.cmd")
      : resolve(apiRoot, "node_modules/.bin/prisma");

  const env = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    XDG_CACHE_HOME: cacheHome,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
      process.env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION ?? "yes",
  };
  const shell = process.platform === "win32";

  execFileSync(prismaBinary, ["db", "execute", "--stdin"], {
    cwd: apiRoot,
    env,
    input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;\n",
    stdio: ["pipe", "pipe", "pipe"],
    shell,
  });

  execFileSync(prismaBinary, build, {
    cwd: apiRoot,
    env,
    stdio: "pipe",
    shell,
  });
}

export async function resetAuthWorkspaceDatabase(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.adminAccountCommandReceipt.deleteMany();
  await prisma.repositoryScanJob.deleteMany();
  await prisma.repositorySnapshot.deleteMany();
  await prisma.repositoryConnection.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.outboxMessage.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.auditExportRequest.deleteMany();
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
