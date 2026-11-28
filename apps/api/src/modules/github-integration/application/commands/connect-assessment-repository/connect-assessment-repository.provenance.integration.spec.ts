import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import { PrismaPg } from "@prisma/adapter-pg";
import { randomUUID } from "node:crypto";
import {
  AgentExecutionState,
  AssessmentRuntimeControlState,
  CredentialProvider,
  PrismaClient,
  RepositoryAuthenticationMode,
  RepositoryScanJobStatus,
  RepositoryScanTriggerSource,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_SCAN_JOB_STATUSES,
  RUNTIME_HYDRATION_TICKET_REASONS,
} from "@lcsp/contracts/github-integration";
import { GITHUB_CREDENTIAL_ERROR_CODES } from "@lcsp/contracts/github-integration";

import { ConfigureProviderCredentialCommand } from "../configure-provider-credential/configure-provider-credential.command.js";
import { ConfigureProviderCredentialHandler } from "../configure-provider-credential/configure-provider-credential.handler.js";
import { ConnectAssessmentRepositoryCommand } from "./connect-assessment-repository.command.js";
import { ConnectAssessmentRepositoryHandler } from "./connect-assessment-repository.handler.js";
import { PrismaCredentialPersistenceUnitOfWork } from "../../../infrastructure/persistence/prisma-credential-persistence.unit-of-work.js";
import { PrismaActiveProviderCredentialResolver } from "../../../infrastructure/persistence/prisma-active-provider-credential.resolver.js";
import { PrismaDatabaseCredentialStore } from "../../../infrastructure/persistence/prisma-database-credential.store.js";
import { EnvelopeEncryptionService } from "../../../infrastructure/security/envelope-encryption.service.js";
import { DevelopmentStaticKeyEncryptionKeyProvider } from "../../../infrastructure/security/development-static-key-encryption-key.provider.js";
import { GitLabCliProviderError } from "../../../infrastructure/gitlab/gitlab-cli-repository.provider.js";
import { PrismaRepositoryConnectionRepository } from "../../../infrastructure/persistence/prisma-github-integration.repository.js";
import { PrismaRepositorySnapshotRepository } from "../../../infrastructure/persistence/prisma-repository-snapshot.repository.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { PinSnapshotHandler } from "../pin-snapshot/pin-snapshot.handler.js";
import { PinSnapshotCommand } from "../pin-snapshot/pin-snapshot.command.js";
import { CredentialLease } from "../../security/credential-lease.js";
import { ASSESSMENT_ROOT_BOUNDARY } from "@lcsp/contracts/assessment-domain";
import { RuntimeHydrationTicketLifecycle } from "../../services/runtime-hydration-ticket-lifecycle.service.js";
import { DisconnectProviderCredentialCommand } from "../disconnect-provider-credential/disconnect-provider-credential.command.js";
import { DisconnectProviderCredentialHandler } from "../disconnect-provider-credential/disconnect-provider-credential.handler.js";
import { RepositorySnapshot } from "../../../domain/entities/repository-snapshot.entity.js";
import { GITHUB_INTEGRATION_EVENT_TYPES } from "@lcsp/contracts/github-integration";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import { assertDedicatedTestDatabaseUrl } from "../../../../../../test/support/auth-workspace-test-helpers.js";

const databaseUrl = process.env.PHASE25_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;
const fixtureUserIds = [
  "provenance-user",
  "missing-user",
  "scope-user",
  "other-user",
  "github-snapshot-user",
  "disconnect-audit-user",
];
const fixtureAssessmentIds = [
  "provenance-a1",
  "provenance-a2",
  "provenance-missing",
  "scope-assessment",
  "provenance-denied",
  "provenance-invalid",
  "provenance-atomicity",
  "provenance-snapshot",
  "github-snapshot-assessment",
  "github-stale-assessment",
  "github-stale-credential",
  "github-audit-rollback",
  "github-locked-assessment",
  "github-hydration-lock",
];

run("ConnectAssessmentRepository credential provenance", () => {
  let prisma: PrismaClient;
  let configure: ConfigureProviderCredentialHandler;
  let connect: ConnectAssessmentRepositoryHandler;
  let rollbackConnect: ConnectAssessmentRepositoryHandler;
  let unitOfWork: PrismaCredentialPersistenceUnitOfWork;
  const provider = {
    validateIdentity: jest.fn(async () => ({
      id: "7001",
      login: "synthetic-user",
      htmlUrl: "https://example.test/synthetic-user",
    })),
    validateRepositoryAccess: jest.fn(
      async (_lease, repositoryFullName: string) =>
        repositoryFullName.includes("acme/example-repo")
          ? {
              id: "8002",
              name: "example-repo",
              fullName: "acme/example-repo",
              defaultBranch: "main",
              private: true,
            }
          : {
              id: "7002",
              name: "project",
              fullName: "group/project",
              defaultBranch: "main",
              private: true,
            },
    ),
  };

  beforeAll(async () => {
    // Why: This suite removes fixed fixture identities; never allow a local
    // development database or a remote database to satisfy the opt-in URL.
    assertDedicatedTestDatabaseUrl(databaseUrl!);
    prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl!) });
    await prisma.$connect();
    await prisma.repositorySnapshot.deleteMany({
      where: { assessmentId: { in: fixtureAssessmentIds } },
    });
    await prisma.repositoryConnection.deleteMany({
      where: {
        OR: [
          { userId: { in: fixtureUserIds } },
          { assessmentId: { in: fixtureAssessmentIds } },
        ],
      },
    });
    await prisma.assessment.deleteMany({
      where: {
        OR: [
          { id: { in: fixtureAssessmentIds } },
          { ownerId: { in: fixtureUserIds } },
        ],
      },
    });
    await prisma.providerCredential.deleteMany({
      where: { ownerUserId: { in: fixtureUserIds } },
    });
    const prismaService = prisma as never;
    const encryption = new EnvelopeEncryptionService(
      new DevelopmentStaticKeyEncryptionKeyProvider(
        "test",
        new Map([["test", Buffer.alloc(32, 9)]]),
      ),
    );
    unitOfWork = new PrismaCredentialPersistenceUnitOfWork(
      prismaService,
      encryption,
    );
    const config = {
      get: () => ({}),
    } as never;
    const registry = { get: () => provider } as never;
    configure = new ConfigureProviderCredentialHandler(
      config,
      unitOfWork,
      registry,
    );
    const store = new PrismaDatabaseCredentialStore(
      prismaService,
      encryption,
      prisma,
    );
    const resolver = new PrismaActiveProviderCredentialResolver(
      prismaService,
      store,
    );
    connect = new ConnectAssessmentRepositoryHandler(
      prismaService,
      config,
      unitOfWork,
      resolver,
      registry,
    );
    rollbackConnect = new (class extends ConnectAssessmentRepositoryHandler {
      protected persistRepositoryConnection(
        _transaction: never,
        _data: never,
      ): Promise<unknown> {
        throw new Error("synthetic repository persistence failure");
      }
    })(prismaService, config, unitOfWork, resolver, registry);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const configureCommand = (credential: string) =>
    new ConfigureProviderCredentialCommand(
      "provenance-user",
      AUTH_USER_ROLES.customer,
      "synthetic-session",
      CREDENTIAL_PROVIDERS.gitlab,
      credential,
      "synthetic-correlation",
    );

  const configureFor = (
    userId: string,
    providerName: string,
    credential: string,
  ) =>
    new ConfigureProviderCredentialCommand(
      userId,
      AUTH_USER_ROLES.customer,
      "synthetic-session",
      providerName,
      credential,
      "synthetic-correlation",
    );

  const connectCommand = (assessmentId: string) =>
    new ConnectAssessmentRepositoryCommand(
      assessmentId,
      "provenance-user",
      AUTH_USER_ROLES.customer,
      "https://gitlab.com/group/project",
      "synthetic-correlation",
    );

  const ensureUser = async (userId: string) => {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: "synthetic-password-hash",
        emailVerified: true,
        failedLoginCount: 0,
      },
    });
  };

  const createAssessment = async (id: string, ownerId = "provenance-user") => {
    await ensureUser(ownerId);
    await prisma.assessment.create({
      data: {
        id,
        ownerId,
        name: id,
        lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
        lifecycleRevision: 0,
      },
    });
  };

  const countForAssessment = async (assessmentId: string) => ({
    authorizations: 0,
    connections: await prisma.repositoryConnection.count({
      where: { assessmentId },
    }),
  });

  it("keeps historical connections on the stable credential and versions new ones", async () => {
    await configure.execute(configureCommand("synthetic-provenance-a"));
    await createAssessment("provenance-a1");
    const first = await connect.execute(connectCommand("provenance-a1"));
    const firstConnection = await prisma.repositoryConnection.findUniqueOrThrow(
      {
        where: { id: first.connectionId },
      },
    );
    const credentialA = firstConnection.providerCredentialId!;
    expect(firstConnection.authenticationMode).toBe(
      RepositoryAuthenticationMode.GITLAB_CLI_CREDENTIAL,
    );
    expect(firstConnection.credentialAuthorizedByUserId).toBe(
      "provenance-user",
    );

    await configure.execute(configureCommand("synthetic-provenance-b"));
    const historical = await prisma.repositoryConnection.findUniqueOrThrow({
      where: { id: first.connectionId },
    });
    expect(historical.providerCredentialId).toBe(credentialA);
    expect(historical.credentialVersion).toBe(1);

    await createAssessment("provenance-a2");
    const second = await connect.execute(connectCommand("provenance-a2"));
    const secondConnection =
      await prisma.repositoryConnection.findUniqueOrThrow({
        where: { id: second.connectionId },
      });
    expect(secondConnection.providerCredentialId).toBe(credentialA);
    expect(secondConnection.credentialVersion).toBe(2);
    expect(secondConnection.providerCredentialId).toBe(
      (
        await prisma.providerCredential.findFirstOrThrow({
          where: {
            ownerUserId: "provenance-user",
            isActive: true,
            provider: CredentialProvider.GITLAB,
          },
        })
      ).id,
    );

    await connect.execute(connectCommand("provenance-a2"));
    expect(
      await prisma.repositoryConnection.count({
        where: { assessmentId: "provenance-a2" },
      }),
    ).toBe(1);
  });

  it("does not persist when the provider credential is missing", async () => {
    const assessmentId = "provenance-missing";
    await createAssessment(assessmentId, "missing-user");
    provider.validateRepositoryAccess.mockClear();
    await expect(
      connect.execute(
        new ConnectAssessmentRepositoryCommand(
          assessmentId,
          "missing-user",
          AUTH_USER_ROLES.customer,
          "https://gitlab.com/group/project",
          "synthetic-correlation",
        ),
      ),
    ).rejects.toBeDefined();
    expect(await countForAssessment(assessmentId)).toEqual({
      authorizations: 0,
      connections: 0,
    });
    expect(provider.validateRepositoryAccess).not.toHaveBeenCalled();
  });

  it("selects credentials by provider and owner scope", async () => {
    await configure.execute(
      configureFor(
        "scope-user",
        CREDENTIAL_PROVIDERS.github,
        "synthetic-github-scope-credential",
      ),
    );
    await configure.execute(
      configureFor(
        "scope-user",
        CREDENTIAL_PROVIDERS.gitlab,
        "synthetic-gitlab-scope-credential",
      ),
    );
    await configure.execute(
      configureFor(
        "other-user",
        CREDENTIAL_PROVIDERS.gitlab,
        "synthetic-other-user-credential",
      ),
    );
    await createAssessment("scope-assessment", "scope-user");
    const result = await connect.execute(
      new ConnectAssessmentRepositoryCommand(
        "scope-assessment",
        "scope-user",
        AUTH_USER_ROLES.customer,
        "https://gitlab.com/group/project",
        "synthetic-correlation",
      ),
    );
    const connection = await prisma.repositoryConnection.findUniqueOrThrow({
      where: { id: result.connectionId },
    });
    expect(connection.provider).toBe(CredentialProvider.GITLAB);
    expect(connection.userId).toBe("scope-user");
  });

  it("does not persist access-denied or invalid-provider failures", async () => {
    await configure.execute(configureCommand("synthetic-negative-credential"));
    const deniedAssessment = "provenance-denied";
    await createAssessment(deniedAssessment);
    provider.validateRepositoryAccess.mockRejectedValueOnce(
      new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.repositoryAccessDenied,
      ),
    );
    await expect(
      connect.execute(connectCommand(deniedAssessment)),
    ).rejects.toBeDefined();
    expect(await countForAssessment(deniedAssessment)).toEqual({
      authorizations: 0,
      connections: 0,
    });

    const invalidAssessment = "provenance-invalid";
    await createAssessment(invalidAssessment);
    provider.validateRepositoryAccess.mockRejectedValueOnce(
      new GitLabCliProviderError(
        GITHUB_CREDENTIAL_ERROR_CODES.credentialInvalid,
      ),
    );
    await expect(
      connect.execute(connectCommand(invalidAssessment)),
    ).rejects.toBeDefined();
    expect(await countForAssessment(invalidAssessment)).toEqual({
      authorizations: 0,
      connections: 0,
    });
  });

  it("rolls back authorization when connection persistence fails", async () => {
    await configure.execute(configureCommand("synthetic-atomicity-credential"));
    const assessmentId = "provenance-atomicity";
    await createAssessment(assessmentId);
    const before = await countForAssessment(assessmentId);
    await expect(
      rollbackConnect.execute(connectCommand(assessmentId)),
    ).rejects.toThrow("synthetic repository persistence failure");
    expect(await countForAssessment(assessmentId)).toEqual(before);
    expect(
      await prisma.providerCredential.count({
        where: {
          ownerUserId: "provenance-user",
          provider: CredentialProvider.GITLAB,
          isActive: true,
        },
      }),
    ).toBe(1);
  });

  it("rejects a connection when assessment lifecycle changes during provider I/O", async () => {
    await configure.execute(configureCommand("synthetic-stale-assessment"));
    const assessmentId = "github-stale-assessment";
    await createAssessment(assessmentId);
    // Why: The initial owner/lifecycle read is no longer authority once the
    // external provider call has yielded to another transaction.
    provider.validateRepositoryAccess.mockImplementationOnce(async () => {
      await prisma.assessment.update({
        where: { id: assessmentId },
        data: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE },
      });
      return {
        id: "7002",
        name: "project",
        fullName: "group/project",
        defaultBranch: "main",
        private: true,
      };
    });
    await expect(
      connect.execute(connectCommand(assessmentId)),
    ).rejects.toBeDefined();
    expect(
      await prisma.repositoryConnection.count({ where: { assessmentId } }),
    ).toBe(0);
  });

  it("waits for the assessment row lock and rejects a terminal lifecycle committed by its holder", async () => {
    await configure.execute(configureCommand("synthetic-locked-assessment"));
    const assessmentId = "github-locked-assessment";
    await createAssessment(assessmentId);
    let releaseLock!: () => void;
    let signalLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLock = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const writer = prisma.$transaction(async (tx) => {
      // Why: This real PostgreSQL lock models a lifecycle transition racing
      // the connection's post-provider authority recheck.
      await tx.$queryRaw`SELECT "id" FROM "Assessment" WHERE "id" = ${assessmentId} FOR UPDATE`;
      signalLock();
      await release;
      await tx.assessment.update({
        where: { id: assessmentId },
        data: { lifecycleState: ASSESSMENT_LIFECYCLE_STATES.COMPLETE },
      });
    });
    await locked;
    const connecting = connect.execute(connectCommand(assessmentId));
    void connecting.catch(() => undefined);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        await prisma.repositoryConnection.count({ where: { assessmentId } }),
      ).toBe(0);
    } finally {
      releaseLock();
    }
    await writer;
    await expect(connecting).rejects.toBeDefined();
    expect(
      await prisma.repositoryConnection.count({ where: { assessmentId } }),
    ).toBe(0);
  });

  it("rejects a connection when its credential is revoked during provider I/O", async () => {
    await configure.execute(configureCommand("synthetic-stale-credential"));
    const assessmentId = "github-stale-credential";
    await createAssessment(assessmentId);
    const credential = await prisma.providerCredential.findFirstOrThrow({
      where: {
        ownerUserId: "provenance-user",
        provider: CredentialProvider.GITLAB,
        isActive: true,
      },
    });
    // Why: The provider may validate an old token while revocation commits;
    // the connection write must see the current credential authority.
    provider.validateRepositoryAccess.mockImplementationOnce(async () => {
      await prisma.providerCredential.update({
        where: { id: credential.id },
        data: { isActive: false, status: "REVOKED" },
      });
      return {
        id: "7002",
        name: "project",
        fullName: "group/project",
        defaultBranch: "main",
        private: true,
      };
    });
    await expect(
      connect.execute(connectCommand(assessmentId)),
    ).rejects.toBeDefined();
    expect(
      await prisma.repositoryConnection.count({ where: { assessmentId } }),
    ).toBe(0);
  });

  it("rolls back snapshot and outbox when its required audit insert fails", async () => {
    await configure.execute(configureCommand("synthetic-audit-rollback"));
    const assessmentId = "github-audit-rollback";
    await createAssessment(assessmentId);
    const connected = await connect.execute(connectCommand(assessmentId));
    const snapshot = RepositorySnapshot.create({
      assessmentId,
      connectionId: connected.connectionId,
      repositoryId: "7002",
      repositoryFullName: "group/project",
      branch: "main",
      ref: null,
      commitSha: "c".repeat(40),
      sourcePathPrefix: null,
      providerMetadata: {
        authorDate: null,
        committerDate: null,
        htmlUrl: `https://gitlab.com/group/project/-/commit/${"c".repeat(40)}`,
        requestedRevision: "main",
      },
      actorId: "provenance-user",
    });
    const repository = new PrismaRepositorySnapshotRepository(
      prisma as never,
      new OutboxRepository(prisma as never),
      {
        writeInTx: async () => {
          throw new Error("synthetic audit insert failure");
        },
      } as never,
    );
    await expect(
      repository.saveWithCreatedEvent(
        snapshot,
        {
          aggregateType: OUTBOX_AGGREGATE_TYPES.repositorySnapshot,
          aggregateId: snapshot.id,
          eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
          payload: { snapshotId: snapshot.id },
        },
        {
          eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreatedAudit,
        } as never,
      ),
    ).rejects.toThrow("synthetic audit insert failure");
    expect(
      await prisma.repositorySnapshot.count({ where: { id: snapshot.id } }),
    ).toBe(0);
    expect(
      await prisma.outboxMessage.count({ where: { aggregateId: snapshot.id } }),
    ).toBe(0);
  });

  it("rolls back credential revocation and secret destruction when audit insertion fails", async () => {
    const userId = "disconnect-audit-user";
    await ensureUser(userId);
    await configure.execute(
      configureFor(
        userId,
        CREDENTIAL_PROVIDERS.gitlab,
        "synthetic-disconnect-audit",
      ),
    );
    const before = await prisma.providerCredential.findFirstOrThrow({
      where: {
        ownerUserId: userId,
        provider: CredentialProvider.GITLAB,
        isActive: true,
      },
    });
    const disconnect = new DisconnectProviderCredentialHandler(unitOfWork, {
      writeInTx: async () => {
        throw new Error("synthetic audit insert failure");
      },
    } as never);
    // Why: A failed audit cannot leave the PAT revoked, because retry would
    // then find no active credential and lose the required audit permanently.
    await expect(
      disconnect.execute(
        new DisconnectProviderCredentialCommand(
          userId,
          AUTH_USER_ROLES.customer,
          "session-1",
          CREDENTIAL_PROVIDERS.gitlab,
          "corr-disconnect-audit",
        ),
      ),
    ).rejects.toThrow("synthetic audit insert failure");
    const after = await prisma.providerCredential.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.isActive).toBe(true);
    expect(after.status).toBe(before.status);
    expect(after.envelopeVersion).toBe(before.envelopeVersion);
  });

  it("keeps a RUNNING ticket blocked during an active Root lease and recovers it after Root termination on a new lifecycle instance", async () => {
    await configure.execute(configureCommand("synthetic-hydration-lock"));
    const assessmentId = "github-hydration-lock";
    await createAssessment(assessmentId);
    const connection = await connect.execute(connectCommand(assessmentId));
    const snapshotId = randomUUID();
    const ticketId = randomUUID();
    const threadId = randomUUID();
    const executionId = randomUUID();
    await prisma.repositorySnapshot.create({
      data: {
        id: snapshotId,
        assessmentId,
        connectionId: connection.connectionId,
        repositoryId: "7002",
        repositoryFullName: "group/project",
        branch: "main",
        ref: null,
        commitSha: "d".repeat(40),
        providerMetadata: {},
        actorId: "provenance-user",
      },
    });
    await prisma.repositoryScanJob.create({
      data: {
        id: ticketId,
        assessmentId,
        snapshotId,
        idempotencyKey: `runtime-hydration:${assessmentId}:${snapshotId}`,
        triggerSource: RepositoryScanTriggerSource.TRUSTED,
        status: RepositoryScanJobStatus.RUNNING,
        correlationId: "corr-hydration-lock",
      },
    });
    await prisma.assessmentCase.create({
      data: {
        assessmentId,
        repositorySnapshotId: snapshotId,
        repositoryScanJobId: ticketId,
        repositoryCommit: "d".repeat(40),
        pinnedAt: new Date(),
      },
    });
    await prisma.assessmentRuntime.create({
      data: {
        assessmentId,
        threadId,
        rootAgentVersion: "test",
        checkpointNamespace: "test",
        currentExecutionId: executionId,
        executionState: AgentExecutionState.SUCCEEDED,
      },
    });
    await prisma.assessmentRuntimeTurn.create({
      data: {
        id: executionId,
        assessmentId,
        threadId,
        boundary: ASSESSMENT_ROOT_BOUNDARY,
        logicalRunId: "logical-hydration-lock",
        correlationId: "corr-hydration-lock",
        state: AssessmentRuntimeControlState.COMPLETED,
        contextJson: {},
      },
    });
    let signalLock!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLock = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const writer = prisma.$transaction(async (tx) => {
      // Why: The lease transition owns the runtime row before reconciliation
      // can verify it; the latter must wait and then observe the new lease.
      await tx.$queryRaw`SELECT "assessmentId" FROM "AssessmentRuntime" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`;
      signalLock();
      await release;
      await tx.assessmentRuntime.update({
        where: { assessmentId },
        data: {
          executionState: AgentExecutionState.RUNNING,
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
        },
      });
    });
    await locked;
    const lifecycle = new RuntimeHydrationTicketLifecycle(prisma as never);
    const reconciling = lifecycle.reconcileTerminalRuntime({
      ticketId,
      snapshotId,
    });
    void reconciling.catch(() => undefined);
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(
        (
          await prisma.repositoryScanJob.findUniqueOrThrow({
            where: { id: ticketId },
          })
        ).status,
      ).toBe(RepositoryScanJobStatus.RUNNING);
    } finally {
      releaseLock();
    }
    await writer;
    await expect(reconciling).rejects.toBeDefined();
    expect(
      (
        await prisma.repositoryScanJob.findUniqueOrThrow({
          where: { id: ticketId },
        })
      ).status,
    ).toBe(RepositoryScanJobStatus.RUNNING);

    // Why: The in-memory delivery guard disappears on API restart. A fresh
    // lifecycle instance must still reject the active Root, then use the
    // durable runtime and ticket rows once Root reaches a terminal state.
    const restartedLifecycle = new RuntimeHydrationTicketLifecycle(
      prisma as never,
    );
    await expect(
      restartedLifecycle.reconcileTerminalRuntime({ ticketId, snapshotId }),
    ).rejects.toBeDefined();
    await prisma.assessmentRuntime.update({
      where: { assessmentId },
      data: {
        executionState: AgentExecutionState.SUCCEEDED,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    await expect(
      restartedLifecycle.reconcileTerminalRuntime({ ticketId, snapshotId }),
    ).resolves.toEqual({
      status: REPOSITORY_SCAN_JOB_STATUSES.failed,
      changed: true,
    });
    const recoveredTicket = await prisma.repositoryScanJob.findUniqueOrThrow({
      where: { id: ticketId },
    });
    expect(recoveredTicket.status).toBe(RepositoryScanJobStatus.FAILED);
    expect(recoveredTicket.blockedReason).toBe(
      RUNTIME_HYDRATION_TICKET_REASONS.outcomeUnproven,
    );
  });

  it("pins a snapshot from the readiness-created GitLab connection", async () => {
    await configure.execute(configureCommand("synthetic-snapshot-credential"));
    const assessmentId = "provenance-snapshot";
    await createAssessment(assessmentId);
    const result = await connect.execute(connectCommand(assessmentId));
    const connectionRepository = new PrismaRepositoryConnectionRepository(
      prisma as never,
    );
    const snapshotRepository = new PrismaRepositorySnapshotRepository(
      prisma as never,
      new OutboxRepository(prisma as never),
      new AuditWriterService(prisma as never),
    );
    const snapshotProvider = {
      resolveCommit: jest.fn(async () => ({
        sha: "a".repeat(40),
        repositoryFullName: "group/project",
        htmlUrl: `https://gitlab.com/group/project/-/commit/${"a".repeat(40)}`,
        authorDate: "2026-01-01T00:00:00.000Z",
        committerDate: "2026-01-01T00:00:01.000Z",
      })),
    };
    const githubSnapshotProvider = {
      resolveCommit: jest.fn(async () => ({
        sha: "b".repeat(40),
        repositoryFullName: "acme/example-repo",
        htmlUrl: `https://github.com/acme/example-repo/commit/${"b".repeat(40)}`,
        authorDate: "2026-01-01T00:00:00.000Z",
        committerDate: "2026-01-01T00:00:01.000Z",
      })),
    };
    const pin = new PinSnapshotHandler(
      connectionRepository,
      snapshotRepository,
      {
        resolveForConnection: jest.fn(
          async () =>
            new CredentialLease("synthetic-snapshot-credential", {
              internalCredentialId: "synthetic",
              credentialVersion: 1,
              repositoryFullName: "group/project",
              expiresAt: new Date(Date.now() + 60_000),
            }),
        ),
        markInvalid: jest.fn(),
      } as never,
      prisma as never,
      { write: jest.fn(async () => undefined) } as never,
      { get: () => snapshotProvider } as never,
    );
    await pin.execute(
      new PinSnapshotCommand(
        assessmentId,
        "provenance-user",
        AUTH_USER_ROLES.customer,
        undefined,
        result.connectionId,
        undefined,
        undefined,
        undefined,
        "synthetic-correlation",
      ),
    );
    const snapshot = await prisma.repositorySnapshot.findFirstOrThrow({
      where: { assessmentId },
    });
    expect(snapshot.connectionId).toBe(result.connectionId);
    expect(snapshot.repositoryId).toBe("7002");
    expect(snapshot.repositoryFullName).toBe("group/project");
    expect(snapshot.commitSha).toBe("a".repeat(40));
    expect(JSON.stringify(snapshot.providerMetadata)).not.toContain(
      "synthetic-snapshot-credential",
    );
  });

  it("pins a snapshot from the readiness-created GitHub CLI connection", async () => {
    const userId = "github-snapshot-user";
    const assessmentId = "github-snapshot-assessment";
    await configure.execute(
      configureFor(
        userId,
        CREDENTIAL_PROVIDERS.github,
        "synthetic-github-snapshot-credential",
      ),
    );
    await createAssessment(assessmentId, userId);
    const connectionResult = await connect.execute(
      new ConnectAssessmentRepositoryCommand(
        assessmentId,
        userId,
        AUTH_USER_ROLES.customer,
        "https://github.com/acme/example-repo",
        "synthetic-correlation",
      ),
    );
    const githubSnapshotProvider = {
      resolveCommit: jest.fn(async () => ({
        sha: "b".repeat(40),
        repositoryFullName: "acme/example-repo",
        htmlUrl: `https://github.com/acme/example-repo/commit/${"b".repeat(40)}`,
        authorDate: "2026-01-01T00:00:00.000Z",
        committerDate: "2026-01-01T00:00:01.000Z",
      })),
    };
    const pin = new PinSnapshotHandler(
      new PrismaRepositoryConnectionRepository(prisma as never),
      new PrismaRepositorySnapshotRepository(
        prisma as never,
        new OutboxRepository(prisma as never),
        new AuditWriterService(prisma as never),
      ),
      {
        resolveForConnection: jest.fn(
          async () =>
            new CredentialLease("synthetic-github-snapshot-credential", {
              internalCredentialId: "synthetic",
              credentialVersion: 1,
              repositoryFullName: "acme/example-repo",
              expiresAt: new Date(Date.now() + 60_000),
            }),
        ),
        markInvalid: jest.fn(),
      } as never,
      prisma as never,
      { write: jest.fn(async () => undefined) } as never,
      { get: () => githubSnapshotProvider } as never,
    );
    await pin.execute(
      new PinSnapshotCommand(
        assessmentId,
        userId,
        AUTH_USER_ROLES.customer,
        undefined,
        connectionResult.connectionId,
        undefined,
        undefined,
        undefined,
        "synthetic-correlation",
      ),
    );
    const snapshot = await prisma.repositorySnapshot.findFirstOrThrow({
      where: { assessmentId },
    });
    expect(snapshot.connectionId).toBe(connectionResult.connectionId);
    expect(snapshot.repositoryFullName).toBe("acme/example-repo");
    expect(snapshot.commitSha).toBe("b".repeat(40));
    expect(JSON.stringify(snapshot.providerMetadata)).not.toContain(
      "synthetic-github-snapshot-credential",
    );
  });
});
