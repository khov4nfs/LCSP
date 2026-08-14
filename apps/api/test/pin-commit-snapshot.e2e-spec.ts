import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  GITHUB_INTEGRATION_ERROR_CODES,
  GITHUB_INTEGRATION_EVENT_TYPES,
  GITHUB_REPOSITORY_PERMISSION_LEVELS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { OUTBOX_MESSAGE_SCHEMA_VERSION } from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS, PBAC_REASON_CODE } from "@lcsp/contracts/pbac";
/** MW-gh-003: Pin Commit Snapshot Endpoint. */

import * as assert from "node:assert/strict";

import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/app.module.js";
import type { SignInSuccess } from "../src/modules/auth-workspace/application/contracts/auth-workspace/sign-in.contract.js";
import type { PinSnapshotDto } from "../src/modules/github-integration/application/contracts/github-integration/pin-snapshot.contract.js";
import { GitHubAppClient } from "../src/modules/github-integration/infrastructure/github/github-app.client.js";
import { OutboxPublisherService } from "../src/platform/outbox/outbox-publisher.service.js";
import { RabbitMqClient } from "../src/platform/outbox/rabbitmq.client.js";
import {
  pushPrismaSchema,
  resetAuthWorkspaceDatabase,
  seedAuthWorkspaceFixture,
  TEST_DATABASE_URL,
} from "./support/auth-workspace-test-helpers.js";
import { httpRequest, problemCode, successBody } from "./support/http.js";

const RESOLVED_SHA = "a".repeat(40);

describe("Pin Commit Snapshot Endpoint (e2e) [MW-gh-003]", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let managerToken: string;
  let resolveCommitError = false;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    pushPrismaSchema();
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GitHubAppClient)
      .useValue({
        resolveCommit: () => {
          if (resolveCommitError) {
            return Promise.reject(new Error("unresolvable"));
          }
          return Promise.resolve({
            sha: RESOLVED_SHA,
            repositoryFullName: "acme/example-repo",
            htmlUrl: `https://github.com/acme/example-repo/commit/${RESOLVED_SHA}`,
            authorDate: "2026-07-18T00:00:00.000Z",
            committerDate: "2026-07-18T00:00:01.000Z",
          });
        },
      })
      .overrideProvider(RabbitMqClient)
      .useValue({
        ensureConnected: () => Promise.resolve(),
        publish: () => Promise.resolve(),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  beforeEach(async () => {
    resolveCommitError = false;
    await prisma.repositorySnapshot.deleteMany();
    await prisma.repositoryConnection.deleteMany();
    await prisma.assessment.deleteMany();
    await resetAuthWorkspaceDatabase(prisma);
    await seedAuthWorkspaceFixture(prisma);
    await prisma.assessment.create({
      data: {
        id: "assessment-1",
        organizationId: "org-1",
        ownerId: "user-1",
        name: "Snapshot assessment",
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
    });
    await prisma.repositoryConnection.create({
      data: {
        id: "connection-1",
        assessmentId: "assessment-1",
        organizationId: "org-1",
        userId: "user-1",
        installationId: "installation-1",
        repositoryId: "repo-1",
        repositoryName: "example-repo",
        repositoryFullName: "acme/example-repo",
        defaultBranch: "main",
        permissions: { contents: GITHUB_REPOSITORY_PERMISSION_LEVELS.read },
        status: REPOSITORY_CONNECTION_STATUSES.active,
      },
    });

    const signIn = await httpRequest(app).post("/auth/sign-in").send({
      email: "manager@acme.test",
      password: "CorrectHorseBatteryStaple!",
      organization_id: "org-1",
    });
    managerToken = successBody<SignInSuccess>(signIn).session_token;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("T01/T06/T07/T08: Manager pins metadata-only snapshot and outbox event", async () => {
    const response = await httpRequest(app)
      .post("/assessments/assessment-1/snapshots")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ connection_id: "connection-1", branch: "main" });
    const body = successBody<PinSnapshotDto>(response);

    assert.equal(response.status, 201);
    assert.equal(body.commit_sha, RESOLVED_SHA);
    assert.equal(body.status, REPOSITORY_SNAPSHOT_STATUSES.ready);
    assert.equal(body.branch, "main");

    const snapshot = await prisma.repositorySnapshot.findUnique({
      where: { id: body.snapshot_id },
    });
    assert.ok(snapshot);
    assert.deepEqual(snapshot.providerMetadata, {
      authorDate: "2026-07-18T00:00:00.000Z",
      committerDate: "2026-07-18T00:00:01.000Z",
      htmlUrl: `https://github.com/acme/example-repo/commit/${RESOLVED_SHA}`,
      requestedRevision: "main",
    });
    assert.equal("source" in snapshot, false);
    assert.doesNotMatch(JSON.stringify(snapshot), /raw source/i);

    const event = await prisma.outboxMessage.findFirst({
      where: {
        aggregateId: body.snapshot_id,
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreated,
      },
    });
    assert.ok(event);
    assert.equal(
      (event.payload as { snapshotId?: string }).snapshotId,
      body.snapshot_id,
    );
    assert.equal(
      (event.payload as { schemaVersion?: string }).schemaVersion,
      OUTBOX_MESSAGE_SCHEMA_VERSION,
    );
    assert.equal(
      (event.payload as { correlationId?: string }).correlationId,
      body.correlationId,
    );
    const audit = await prisma.authAuditEvent.findFirst({
      where: {
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotCreatedAudit,
        resourceId: body.snapshot_id,
      },
    });
    assert.ok(audit);
    assert.equal(
      (audit.payload as { schemaVersion?: string }).schemaVersion,
      AUDIT_EVENT_SCHEMA_VERSION,
    );
    assert.equal(
      (audit.payload as { redactionStatus?: string }).redactionStatus,
      AUDIT_REDACTION_STATUSES.none,
    );
  });

  it("T02: explicit commit SHA is accepted as the immutable revision", async () => {
    const response = await httpRequest(app)
      .post("/assessments/assessment-1/snapshots")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ connection_id: "connection-1", commit_sha: "b".repeat(40) });

    assert.equal(response.status, 201);
    assert.equal(
      successBody<PinSnapshotDto>(response).commit_sha,
      RESOLVED_SHA,
    );
  });

  it("T03: unresolvable ref is audited and creates no snapshot or outbox event", async () => {
    resolveCommitError = true;
    const beforeOutbox = await prisma.outboxMessage.count();

    const response = await httpRequest(app)
      .post("/assessments/assessment-1/snapshots")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ connection_id: "connection-1", ref: "refs/heads/missing" });

    assert.equal(response.status, 400);
    assert.equal(
      problemCode(response),
      GITHUB_INTEGRATION_ERROR_CODES.refNotResolvable,
    );
    assert.equal(await prisma.repositorySnapshot.count(), 0);
    assert.equal(await prisma.outboxMessage.count(), beforeOutbox);
    assert.ok(
      await prisma.authAuditEvent.findFirst({
        where: {
          eventType: GITHUB_INTEGRATION_EVENT_TYPES.snapshotPinFailedAudit,
        },
      }),
    );
  });

  it("T04: connection outside the session organization is hidden", async () => {
    await prisma.repositoryConnection.update({
      where: { id: "connection-1" },
      data: { organizationId: "org-other" },
    });

    const response = await httpRequest(app)
      .post("/assessments/assessment-1/snapshots")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ connection_id: "connection-1", branch: "main" });

    assert.equal(response.status, 404);
    assert.equal(
      problemCode(response),
      GITHUB_INTEGRATION_ERROR_CODES.connectionNotFound,
    );
  });

  it("T05: actor without snapshot:create is denied by PBAC", async () => {
    await prisma.authPolicy.update({
      where: {
        id_version: {
          id: "policy-manager-workspace",
          version: "2026-06-26",
        },
      },
      data: { actions: [PBAC_ACTIONS.workspaceRead] },
    });

    const response = await httpRequest(app)
      .post("/assessments/assessment-1/snapshots")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ connection_id: "connection-1", branch: "main" });

    assert.equal(response.status, 403);
    assert.equal(problemCode(response), PBAC_REASON_CODE.denied);
    assert.equal(await prisma.repositorySnapshot.count(), 0);
  });

  it("auto-chains a trusted scan job after snapshotCreated when the assessment is submitted", async () => {
    await prisma.assessment.update({
      where: { id: "assessment-1" },
      data: { status: ASSESSMENT_STATUS_CODES.wizardSubmitted },
    });

    const response = await httpRequest(app)
      .post("/assessments/assessment-1/snapshots")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ connection_id: "connection-1", branch: "main" });
    const body = successBody<PinSnapshotDto>(response);

    await app.get(OutboxPublisherService).poll();

    const scanJob = await prisma.repositoryScanJob.findFirst({
      where: { assessmentId: "assessment-1", snapshotId: body.snapshot_id },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(scanJob);
    assert.equal(
      scanJob.triggerSource,
      REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
    );
    assert.equal(
      scanJob.idempotencyKey,
      `snapshot-auto:assessment-1:${body.snapshot_id}`,
    );
    assert.ok(
      await prisma.outboxMessage.findFirst({
        where: {
          aggregateId: scanJob.id,
          eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered,
        },
      }),
    );
  });
});
