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
  hashSecretSync,
  totpForTime,
} from "../../src/modules/auth/infrastructure/security/security.utils.js";

import { createAuthSessionRecord } from "./auth-record-test-helpers.js";

const testSupportDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(testSupportDir, "../..");

// Rationale ("Why"): Destructive test suites execute TRUNCATE, schema resets, and fixture purges.
// Running these operations against a shared or production database would result in catastrophic data loss.
// Mechanism ("How"): Parses the connection string, verifies that the target host is strictly a local loopback
// (localhost, 127.0.0.1, ::1) and that the target database name carries a designated test suffix (_test, _e2e).
// Invariants & Constraints: Fails closed unconditionally before any database client is initialized or query executed.

/**
 * Asserts that the provided database URL targets a dedicated disposable local test database.
 *
 * Business purpose: Protect non-test and production PostgreSQL instances (e.g. lcsp_local, prod) from destructive test operations (TRUNCATE, seed reset).
 * Business rules:
 * - Target host must strictly resolve to local loopback (localhost, 127.0.0.1, or ::1). Remote hosts are strictly forbidden.
 * - Database name must carry a designated test identifier ending with _test or _e2e.
 * - Local development or production databases (e.g. lcsp_local, lcsp_dev, lcsp_production, postgres) are strictly forbidden under all circumstances.
 * - LCSP_TEST_POSTGRES_DB cannot be used to legitimize lcsp_local or any non-test database; it must also carry an approved test suffix.
 * Execution flow:
 * 1. Parse database connection string via standard URL parser.
 * 2. Validate that hostname belongs to local loopback address set.
 * 3. Verify that LCSP_TEST_POSTGRES_DB (if configured) does not point to forbidden or non-test database names.
 * 4. Verify that target database name does not contain forbidden production/local/dev terms.
 * 5. Extract path database name and verify compliance with test suffix naming conventions (_test, _e2e).
 * 6. Return verified URL string on success.
 * Failure cases:
 * - Throws Error if URL is malformed or unparseable.
 * - Throws Error if hostname is non-local or remote IP/domain.
 * - Throws Error if database name targets local/dev/prod (such as lcsp_local).
 * - Throws Error if LCSP_TEST_POSTGRES_DB is configured with an invalid or non-test database name.
 * - Throws Error if database name lacks mandatory test suffix (_test, _e2e).
 * Side effects: None (read-only validation).
 */
export function assertDedicatedTestDatabaseUrl(urlStr: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    // Rationale ("Why"): Never interpolate urlStr into the error message to avoid leaking database passwords or credentials to logs.
    throw new Error(
      "Invalid DATABASE_URL provided for test execution (URL parse error)",
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!allowedHosts.has(hostname)) {
    throw new Error(
      `Safety guard: Test database host must be local loopback (localhost, 127.0.0.1, ::1), got "${hostname}"`,
    );
  }

  const allowedDbSuffixes = ["_test", "_e2e"];
  const forbiddenPatterns = [
    "local",
    "prod",
    "production",
    "dev",
    "development",
    "staging",
    "stage",
    "master",
    "main",
  ];

  // 1. Guard against malicious or accidental misconfiguration of LCSP_TEST_POSTGRES_DB
  if (process.env.LCSP_TEST_POSTGRES_DB) {
    const configuredDb = process.env.LCSP_TEST_POSTGRES_DB.trim().toLowerCase();
    const configuredHasValidSuffix = allowedDbSuffixes.some((suffix) =>
      configuredDb.endsWith(suffix),
    );
    const configuredIsForbidden =
      configuredDb === "postgres" ||
      configuredDb === "lcsp_local" ||
      forbiddenPatterns.some(
        (pat) =>
          configuredDb === pat ||
          configuredDb === `lcsp_${pat}` ||
          configuredDb.startsWith(`${pat}_`) ||
          configuredDb.endsWith(`_${pat}`) ||
          configuredDb.includes(`_${pat}_`),
      );

    if (!configuredHasValidSuffix || configuredIsForbidden) {
      throw new Error(
        `Safety guard: LCSP_TEST_POSTGRES_DB="${configuredDb}" is invalid; it must end with '_test' or '_e2e' and cannot target local/dev/prod databases`,
      );
    }
  }

  // 2. Guard target database name against forbidden production/development databases
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isForbiddenName =
    dbName === "postgres" ||
    dbName === "lcsp_local" ||
    forbiddenPatterns.some(
      (pat) =>
        dbName === pat ||
        dbName === `lcsp_${pat}` ||
        dbName.startsWith(`${pat}_`) ||
        dbName.endsWith(`_${pat}`) ||
        dbName.includes(`_${pat}_`),
    );

  if (isForbiddenName) {
    throw new Error(
      `Safety guard: Database name "${dbName}" targets a local/development/production database and cannot be used for destructive tests`,
    );
  }

  // 3. Target database name must strictly end with _test or _e2e
  const isDedicatedTestDb = allowedDbSuffixes.some((suffix) =>
    dbName.endsWith(suffix),
  );

  if (!isDedicatedTestDb) {
    throw new Error(
      `Safety guard: Test database name must end with '_test' or '_e2e', got "${dbName}"`,
    );
  }

  return urlStr;
}

const configuredTestDatabaseUrl =
  process.env.DATABASE_URL ?? process.env.PHASE25_DATABASE_URL;

if (!configuredTestDatabaseUrl) {
  throw new Error(
    "E2E/integration tests require an explicit disposable DATABASE_URL (or PHASE25_DATABASE_URL)",
  );
}

assertDedicatedTestDatabaseUrl(configuredTestDatabaseUrl);

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
      passwordHash: hashSecretSync("CorrectHorseBatteryStaple!"),
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
  await prisma.billableInvocationAdmission.deleteMany();
  await prisma.creditLedgerEntry.deleteMany();
  await prisma.billingReservation.deleteMany();
  await prisma.billingWallet.deleteMany();
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
        passwordHash: hashSecretSync("CorrectHorseBatteryStaple!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
      {
        id: unverifiedUserId,
        email: "pending@acme.test",
        passwordHash: hashSecretSync("VerifyMe123!"),
        emailVerified: false,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.customer,
      },
      {
        id: noMembershipUserId,
        email: "nomembership@acme.test",
        passwordHash: hashSecretSync("NoMembership123!"),
        emailVerified: true,
        failedLoginCount: 0,
        role: AUTH_USER_ROLES.admin,
      },
      {
        id: revokedMembershipUserId,
        email: "revoked-member@acme.test",
        passwordHash: hashSecretSync("RevokedMembership123!"),
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
