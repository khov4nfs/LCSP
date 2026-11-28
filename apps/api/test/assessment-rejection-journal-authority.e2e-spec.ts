import * as assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, AgentStreamBoundaryType } from "@prisma/client";

import {
  TEST_DATABASE_URL,
  assertDedicatedTestDatabaseUrl,
  ensureMigratedSchema,
} from "./support/auth-workspace-test-helpers.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const rejection = (eventId: string) => ({
  agentStreamEvent: {
    eventId,
    eventType: "CUSTOM_PROGRESS",
    boundaryType: "RULE_SET_PREPARATION",
    data: {
      activity_kind: "RULE_AUTHORING_TOOL_REJECTED",
      rejection: { toolCallId: "call-a", rejectionCode: "INVALID_DRAFT" },
    },
  },
});

const journalRow = (runId: string, sequence: number, eventId: string) => ({
  boundaryType: AgentStreamBoundaryType.RULE_SET_PREPARATION,
  boundaryId: "preparation-fixture",
  runId,
  correlationId: "correlation-fixture",
  sequence,
  summary: "rule rejection",
  outputSummaryJson: rejection(eventId),
});

describe("rule rejection journal authority (dedicated Postgres)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Why: Direct DB probes must never target a developer or production database.
    // How: Validate the dedicated test URL before creating Prisma or applying migrations.
    // Invariant: This suite writes only to a loopback database with a test suffix.
    assertDedicatedTestDatabaseUrl(TEST_DATABASE_URL);
    await ensureMigratedSchema();
    // Why: This isolated suite must apply its new constraint before direct DB probes.
    // How: Run the repository migration command only against the validated dedicated test URL.
    // Invariant: A production or developer database cannot be selected by this test.
    execFileSync(
      resolve(apiRoot, "node_modules/.bin/prisma"),
      ["migrate", "deploy"],
      {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
        stdio: "pipe",
      },
    );
    prisma = new PrismaClient({ adapter: new PrismaPg(TEST_DATABASE_URL) });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it("rejects two rule rejection rows with the same event ID in one run", async () => {
    const runId = `journal-unique-${randomUUID()}`;
    // Why: Callback authorization must never depend on a first-match JSON lookup.
    // How: Try two committed candidates in one transaction and roll back even when the constraint is absent.
    // Invariant: Other event kinds may still reuse worker event IDs without affecting this rule.
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.assessmentRuntimeEvent.create({
          data: journalRow(runId, 1, "same-event"),
        });
        await tx.assessmentRuntimeEvent.create({
          data: journalRow(runId, 2, "same-event"),
        });
        throw new Error("MISSING_REJECTION_UNIQUENESS");
      }),
      (error: unknown) =>
        !String(error).includes("MISSING_REJECTION_UNIQUENESS"),
    );
  });

  it("rejects changing a persisted rule rejection payload", async () => {
    const runId = `journal-immutable-${randomUUID()}`;
    // Why: A verdict cannot remain valid if journal evidence can be rewritten after callback authorization.
    // How: Attempt a direct UPDATE inside a transaction that rolls back in both RED and GREEN cases.
    // Invariant: Unrelated runtime events remain writable under their own lifecycle rules.
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const row = await tx.assessmentRuntimeEvent.create({
          data: journalRow(runId, 1, "event-1"),
        });
        await tx.assessmentRuntimeEvent.update({
          where: { id: row.id },
          data: { outputSummaryJson: rejection("rewritten-event") },
        });
        throw new Error("MISSING_REJECTION_IMMUTABILITY");
      }),
      (error: unknown) =>
        !String(error).includes("MISSING_REJECTION_IMMUTABILITY"),
    );
  });

  it("allows authorized preparation-run deletion to remove rejection evidence", async () => {
    // Why: Legal-source deletion removes a terminal preparation run and all of its children.
    // How: Exercise the actual preparation-run FK cascade with a persisted rejection journal row.
    // Invariant: UPDATE remains forbidden, while owner-lifecycle deletion can erase the whole tree.
    const source = await prisma.legalSourceVersion.create({
      data: { version: `journal-delete-${randomUUID()}`, sourceManifest: {} },
    });
    const runId = `journal-delete-${randomUUID()}`;
    await prisma.ruleSetPreparationRun.create({
      data: {
        id: runId,
        legalSourceVersionId: source.id,
        requestedBy: "SYSTEM",
        executionState: "SUCCEEDED",
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
      },
    });
    await prisma.assessmentRuntimeEvent.create({
      data: {
        ...journalRow(runId, 1, "event-1"),
        boundaryId: runId,
        preparationRunId: runId,
      },
    });
    await prisma.ruleSetPreparationRun.delete({ where: { id: runId } });
    assert.equal(
      await prisma.assessmentRuntimeEvent.count({
        where: { preparationRunId: runId },
      }),
      0,
    );
  });

  it("allows duplicate worker event IDs outside the rejection evidence kind", async () => {
    const runId = `journal-other-${randomUUID()}`;
    // Why: Stream retries and other event categories have their own lifecycle rules.
    // How: Insert two non-rejection rows with one worker ID, then roll back the probe.
    // Invariant: The new unique index covers only rule-authoring rejection evidence.
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        for (const sequence of [1, 2]) {
          await tx.assessmentRuntimeEvent.create({
            data: {
              ...journalRow(runId, sequence, "shared-event"),
              outputSummaryJson: {
                agentStreamEvent: {
                  eventId: "shared-event",
                  eventType: "CUSTOM_PROGRESS",
                  data: { activity_kind: "OTHER" },
                },
              },
            },
          });
        }
        throw new Error("EXPECTED_TEST_ROLLBACK");
      }),
      /EXPECTED_TEST_ROLLBACK/,
    );
  });
});
