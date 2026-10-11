import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  AssessmentEvidenceType,
  RuleDecisionApplicability,
  RuleDecisionComplianceOutcome,
  RepositoryScanTriggerSource,
  DecisionResolutionState,
} from "@prisma/client";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_MAX_ATTEMPTS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  RULE_SET_PREPARATION_SYSTEM_ACTOR,
  ruleSetPreparationIdempotencyKey,
} from "@lcsp/contracts/compliance-rule-set";

import {
  corpusFactory,
  validPacket,
} from "../../../../../test/support/compliance-rule-set-fixtures.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import type { RabbitMqClient } from "../../../../platform/outbox/rabbitmq.client.js";
import { AssessmentRuntimePreparation } from "../../../assessment/application/services/assessment-runtime-preparation.service.js";
import { AssessmentEvidenceInvalidation } from "../../../assessment/application/services/assessment-evidence-invalidation.service.js";
import { ClaimRuleSetPreparationCommand } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { FailRuleSetPreparationCommand } from "../commands/fail-rule-set-preparation/fail-rule-set-preparation.command.js";
import { FailRuleSetPreparationHandler } from "../commands/fail-rule-set-preparation/fail-rule-set-preparation.handler.js";
import { RetryRuleSetPreparationCommand } from "../commands/retry-rule-set-preparation/retry-rule-set-preparation.command.js";
import { RetryRuleSetPreparationHandler } from "../commands/retry-rule-set-preparation/retry-rule-set-preparation.handler.js";
import { StartRuleSetPreparationCommand } from "../commands/start-rule-set-preparation/start-rule-set-preparation.command.js";
import { StartRuleSetPreparationHandler } from "../commands/start-rule-set-preparation/start-rule-set-preparation.handler.js";
import { SubmitComplianceRuleSetCommand } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.command.js";
import { SubmitComplianceRuleSetHandler } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.handler.js";
import { ComplianceRuleSetActivation } from "../../infrastructure/persistence/compliance-rule-set-activation.service.js";
import { ComplianceRuleSetHistoryLoader } from "../../infrastructure/persistence/compliance-rule-set-history.loader.js";
import { LegalCorpusSnapshotLoader } from "../../infrastructure/persistence/legal-corpus-snapshot.service.js";
import { LegalSourceActivatedConsumer } from "../../infrastructure/messaging/legal-source-activated.consumer.js";

/**
 * Real PostgreSQL proof of the shared Compliance Rule Set lifecycle:
 * Legal Source Version -> automatic Rule Set Preparation -> shared immutable rule set that many
 * assessments pin. Rows are namespaced per run; the immutable tables are never cleaned.
 */
const databaseUrl = process.env.DATABASE_URL ?? "";
const loopback = /@(127\.0\.0\.1|localhost)[:/]/u.test(databaseUrl);
const describeDatabase = databaseUrl && loopback ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

describeDatabase(
  "Rule Set Preparation lifecycle PostgreSQL integration",
  () => {
    let prisma: PrismaClient;
    let createCorpus: ReturnType<typeof corpusFactory>;
    let start: StartRuleSetPreparationHandler;
    let retry: RetryRuleSetPreparationHandler;
    let claim: ClaimRuleSetPreparationHandler;
    let fail: FailRuleSetPreparationHandler;
    let submit: SubmitComplianceRuleSetHandler;
    let history: ComplianceRuleSetHistoryLoader;
    let consumer: LegalSourceActivatedConsumer;
    let startCommands = 0;

    beforeAll(async () => {
      prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
      await prisma.$connect();
      createCorpus = corpusFactory(prisma, RUN);
      const service = prisma as unknown as PrismaService;
      const outbox = new OutboxRepository(service);
      start = new StartRuleSetPreparationHandler(service, outbox);
      claim = new ClaimRuleSetPreparationHandler(service);
      fail = new FailRuleSetPreparationHandler(service);
      submit = new SubmitComplianceRuleSetHandler(
        service,
        new LegalCorpusSnapshotLoader(service),
        new ComplianceRuleSetActivation(
          outbox,
          new AuditWriterService(service),
        ),
      );
      history = new ComplianceRuleSetHistoryLoader(service);
      // The CommandBus only ever delivers the commands this module owns.
      const commandBus = {
        execute: (command: unknown) => {
          if (command instanceof StartRuleSetPreparationCommand) {
            startCommands += 1;
            return start.execute(command);
          }
          throw new Error("unexpected command");
        },
      };
      retry = new RetryRuleSetPreparationHandler(service, commandBus as never);
      consumer = new LegalSourceActivatedConsumer(
        {} as RabbitMqClient,
        commandBus as never,
      );
    }, 30_000);

    afterAll(async () => {
      await prisma.legalSourceVersion.updateMany({
        where: { version: { startsWith: `corpus-${RUN}-` } },
        data: { status: "SUPERSEDED" },
      });
      await prisma.$disconnect();
    });

    const activation = (legalSourceVersionId: string) => ({
      legalSourceVersionId,
      correlationId: randomUUID(),
    });
    const runsOf = (legalSourceVersionId: string) =>
      prisma.ruleSetPreparationRun.findMany({
        where: { legalSourceVersionId },
        orderBy: { createdAt: "asc" },
      });
    const commandsFor = (legalSourceVersionId: string) =>
      prisma.outboxMessage.count({
        where: {
          aggregateId: legalSourceVersionId,
          eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.preparationRequested,
        },
      });
    const claimRun = (preparationRunId: string) =>
      claim.execute(
        new ClaimRuleSetPreparationCommand({ preparationRunId }, randomUUID()),
      );
    const failRun = (preparationRunId: string) =>
      fail.execute(
        new FailRuleSetPreparationCommand(
          { preparationRunId, reason: "NO_SUBMISSION" },
          randomUUID(),
        ),
      );
    const submitPacket = (preparationRunId: string, packet = validPacket()) =>
      submit.execute(
        new SubmitComplianceRuleSetCommand(
          {
            preparationRunId,
            idempotencyKey: `submit-${randomUUID()}`,
            packet,
          },
          "test-worker",
          randomUUID(),
        ),
      );
    const retryRun = (preparationRunId: string, operator = "admin-1") =>
      retry.execute(
        new RetryRuleSetPreparationCommand(
          preparationRunId,
          operator,
          randomUUID(),
        ),
      );
    const activate = async (changed = false) => {
      const source = await createCorpus(changed);
      await consumer.handle(activation(source.id));
      const [run] = await runsOf(source.id);
      await claimRun(run.id);
      const result = await submitPacket(run.id);
      return { source, run: run, result };
    };
    async function expectRefusal(
      promise: Promise<unknown>,
      code: string,
      reason?: string,
    ) {
      const error = (await promise.then(
        () => null,
        (e: unknown) => e,
      )) as {
        getResponse(): {
          problem: { code: string; meta?: { reason?: string } };
        };
      } | null;
      expect(error).not.toBeNull();
      const { problem } = error!.getResponse();
      expect(problem.code).toBe(code);
      if (reason) expect(problem.meta?.reason).toBe(reason);
    }

    it("a Legal Source activation starts exactly one system-owned Rule Set Preparation", async () => {
      const source = await createCorpus();
      await consumer.handle(activation(source.id));

      const runs = await runsOf(source.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        executionState: "QUEUED",
        requestedBy: RULE_SET_PREPARATION_SYSTEM_ACTOR,
        idempotencyKey: ruleSetPreparationIdempotencyKey(source.id),
      });
      expect(await commandsFor(source.id)).toBe(1);
    });

    it("a replayed activation event creates no second run and no second paid command", async () => {
      const source = await createCorpus();
      for (let delivery = 0; delivery < 3; delivery += 1) {
        await consumer.handle(activation(source.id));
      }
      expect(await runsOf(source.id)).toHaveLength(1);
      expect(await commandsFor(source.id)).toBe(1);
    });

    it("concurrent deliveries of one activation still yield one logical preparation", async () => {
      const source = await createCorpus();
      await Promise.all(
        Array.from({ length: 8 }, () => consumer.handle(activation(source.id))),
      );
      expect(await runsOf(source.id)).toHaveLength(1);
      expect(await commandsFor(source.id)).toBe(1);
    });

    it("never prepares a superseded, unknown or malformed source and never retries the poison event", async () => {
      const superseded = await createCorpus(false, "SUPERSEDED");
      const before = startCommands;
      await consumer.handle(activation(superseded.id));
      await consumer.handle(activation(randomUUID()));
      await consumer.handle({ legalSourceVersionId: "not-a-uuid" });
      await consumer.handle({});
      expect(await runsOf(superseded.id)).toHaveLength(0);
      expect(await commandsFor(superseded.id)).toBe(0);
      // Only the well-formed events reached the CommandBus; the malformed ones stopped at the adapter.
      expect(startCommands - before).toBe(2);
    });

    it("a duplicated preparation command cannot claim a run twice, so one run never bills two models", async () => {
      const source = await createCorpus();
      await consumer.handle(activation(source.id));
      const [run] = await runsOf(source.id);

      await expect(claimRun(run.id)).resolves.toMatchObject({
        executionState: "RUNNING",
      });
      await expectRefusal(
        claimRun(run.id),
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      );
      const claims = await Promise.allSettled([
        claimRun(run.id),
        claimRun(run.id),
      ]);
      expect(claims.every((result) => result.status === "rejected")).toBe(true);

      // Only a lease that expired without a result (a crashed worker) can be taken over.
      await prisma.ruleSetPreparationRun.update({
        where: { id: run.id },
        data: { startedAt: new Date(Date.now() - 3_600_000) },
      });
      await expect(claimRun(run.id)).resolves.toMatchObject({
        executionState: "RUNNING",
      });
    });

    it("a successful preparation becomes the shared ACTIVE rule set and supersedes the previous one", async () => {
      const first = await activate();
      expect(first.result.lifecycleState).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );
      const second = await activate(true);
      expect(second.result.lifecycleState).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );

      const rows = await prisma.complianceRuleSetVersion.findMany({
        where: {
          id: {
            in: [first.result.ruleSetVersionId, second.result.ruleSetVersionId],
          },
        },
      });
      const state = (id: string) =>
        rows.find((row) => row.id === id)?.lifecycleState;
      expect(state(first.result.ruleSetVersionId)).toBe(
        ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
      );
      expect(state(second.result.ruleSetVersionId)).toBe(
        ARTIFACT_LIFECYCLE_STATES.ACTIVE,
      );
      expect(second.result.previousActiveRuleSetVersionId).toBe(
        first.result.ruleSetVersionId,
      );
      expect(
        await prisma.complianceRuleSetVersion.count({
          where: { lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE },
        }),
      ).toBe(1);
    });

    it("a failed preparation never replaces the current ACTIVE rule set", async () => {
      const current = await activate();
      const source = await createCorpus(true);
      await consumer.handle(activation(source.id));
      const [run] = await runsOf(source.id);
      await claimRun(run.id);
      await failRun(run.id);

      // A submission that fails mechanical validation is recorded INVALID, never authoritative.
      const invalidSource = await createCorpus(true);
      await consumer.handle(activation(invalidSource.id));
      const [invalidRun] = await runsOf(invalidSource.id);
      await claimRun(invalidRun.id);
      const broken = validPacket();
      broken.assessmentRules[0].legalRequirementIds.push("LR-MISSING");
      const invalid = await submitPacket(invalidRun.id, broken);
      expect(invalid.lifecycleState).toBe(ARTIFACT_LIFECYCLE_STATES.INVALID);

      const active = await prisma.complianceRuleSetVersion.findMany({
        where: { lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE },
      });
      expect(active.map((row) => row.id)).toEqual([
        current.result.ruleSetVersionId,
      ]);
      expect(
        (
          await prisma.ruleSetPreparationRun.findUniqueOrThrow({
            where: { id: run.id },
          })
        ).executionState,
      ).toBe("FAILED");
    });

    it("an operator can retry only the latest failed run of the same source, within a bounded budget", async () => {
      const source = await createCorpus();
      await consumer.handle(activation(source.id));
      const [first] = await runsOf(source.id);

      await expectRefusal(
        retryRun(first.id),
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        RULE_SET_PREPARATION_REFUSAL_REASONS.RUN_NOT_FAILED,
      );
      await claimRun(first.id);
      await failRun(first.id);

      // Two operators racing on the same failed run receive one new attempt.
      const [a, b] = await Promise.all([
        retryRun(first.id),
        retryRun(first.id),
      ]);
      expect(a.preparationRunId).toBe(b.preparationRunId);
      const attempts = await runsOf(source.id);
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toMatchObject({
        requestedBy: "admin-1",
        idempotencyKey: ruleSetPreparationIdempotencyKey(source.id, 2),
      });

      // The failed first attempt is no longer the latest, so it cannot be retried again.
      await expectRefusal(
        retryRun(first.id),
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        RULE_SET_PREPARATION_REFUSAL_REASONS.RUN_NOT_LATEST_ATTEMPT,
      );

      for (
        let attempt = 2;
        attempt < RULE_SET_PREPARATION_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const latest = (await runsOf(source.id)).at(-1)!;
        await claimRun(latest.id);
        await failRun(latest.id);
        await retryRun(latest.id);
      }
      const last = (await runsOf(source.id)).at(-1)!;
      expect(await runsOf(source.id)).toHaveLength(
        RULE_SET_PREPARATION_MAX_ATTEMPTS,
      );
      await claimRun(last.id);
      await failRun(last.id);
      await expectRefusal(
        retryRun(last.id),
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        RULE_SET_PREPARATION_REFUSAL_REASONS.ATTEMPTS_EXHAUSTED,
      );
      expect(await commandsFor(source.id)).toBe(
        RULE_SET_PREPARATION_MAX_ATTEMPTS,
      );
    });

    it("refuses to retry a run whose Legal Source Version is no longer the ACTIVE one", async () => {
      const source = await createCorpus();
      await consumer.handle(activation(source.id));
      const [run] = await runsOf(source.id);
      await claimRun(run.id);
      await failRun(run.id);
      await prisma.legalSourceVersion.update({
        where: { id: source.id },
        data: { status: "SUPERSEDED" },
      });
      await expectRefusal(
        retryRun(run.id),
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ACTIVE,
      );
    });

    it("the operations history exposes version, counts, digest, failures and retryability", async () => {
      const source = await createCorpus();
      await consumer.handle(activation(source.id));
      const [run] = await runsOf(source.id);
      await claimRun(run.id);
      await failRun(run.id);

      const view = await history.load();
      const row = view.preparations.find(
        (item) => item.preparationRunId === run.id,
      );
      expect(row).toMatchObject({
        executionState: "FAILED",
        failureReason: "NO_SUBMISSION",
        attempt: 1,
        requestedBy: RULE_SET_PREPARATION_SYSTEM_ACTOR,
        retryable: true,
      });
      const ruleSets = view.ruleSets;
      expect(ruleSets.length).toBeGreaterThan(0);
      for (const ruleSet of ruleSets) {
        expect(ruleSet.ruleSetDigest).toMatch(/^[a-f0-9]{64}$/u);
        expect(ruleSet.legalSourceVersion).toMatch(/^corpus-/u);
      }
    });

    describe("many assessments share one immutable rule set version", () => {
      const owner = `rule-set-owner-${RUN}`;
      const preparation = new AssessmentRuntimePreparation(
        null as never,
        null as never,
      );
      let ownerCreated = false;

      async function createAssessment() {
        if (!ownerCreated) {
          await prisma.user.create({
            data: {
              id: owner,
              email: `${owner}@example.invalid`,
              passwordHash: "x",
              emailVerified: true,
              failedLoginCount: 0,
            },
          });
          ownerCreated = true;
        }
        const id = randomUUID();
        await prisma.$transaction(async (tx) => {
          await tx.assessment.create({
            data: { id, ownerId: owner, name: id },
          });
          await preparation.createCaseInTx(tx, id);
        });
        return id;
      }
      const pinOf = async (assessmentId: string) =>
        (
          await prisma.assessmentCase.findUniqueOrThrow({
            where: { assessmentId },
          })
        ).ruleSetVersionId;
      const runCount = () => prisma.ruleSetPreparationRun.count();

      it("assessments A, B and C pin the same version and trigger no preparation", async () => {
        const shared = await activate();
        const before = await runCount();

        const [a, b, c] = [
          await createAssessment(),
          await createAssessment(),
          await createAssessment(),
        ];

        expect(await pinOf(a)).toBe(shared.result.ruleSetVersionId);
        expect(await pinOf(b)).toBe(shared.result.ruleSetVersionId);
        expect(await pinOf(c)).toBe(shared.result.ruleSetVersionId);
        expect(await runCount()).toBe(before);
      });

      it("a later ACTIVE version never retargets an existing assessment; new assessments pin the new one", async () => {
        const v1 = await activate();
        const a = await createAssessment();
        const v2 = await activate(true);
        const b = await createAssessment();

        expect(v2.result.ruleSetVersionId).not.toBe(v1.result.ruleSetVersionId);
        expect(await pinOf(a)).toBe(v1.result.ruleSetVersionId);
        expect(await pinOf(b)).toBe(v2.result.ruleSetVersionId);
        expect(
          (
            await prisma.complianceRuleSetVersion.findUniqueOrThrow({
              where: { id: v1.result.ruleSetVersionId },
            })
          ).lifecycleState,
        ).toBe(ARTIFACT_LIFECYCLE_STATES.SUPERSEDED);
      });

      it("invalidating evidence maps the historical SQL rule column back to the assessment rule", async () => {
        const shared = await activate();
        const assessmentId = await createAssessment();
        const evidenceId = randomUUID();
        const decisionId = randomUUID();
        const commit = "a".repeat(40);
        await prisma.$transaction(async (tx) => {
          const connectionId = randomUUID();
          const snapshotId = randomUUID();
          const jobId = randomUUID();
          await tx.repositoryConnection.create({
            data: {
              id: connectionId,
              assessmentId,
              userId: owner,
              installationId: connectionId,
              repositoryId: connectionId,
              repositoryName: "fixture",
              repositoryFullName: "fixture/repo",
              defaultBranch: "main",
              permissions: {},
            },
          });
          await tx.repositorySnapshot.create({
            data: {
              id: snapshotId,
              assessmentId,
              connectionId,
              repositoryId: connectionId,
              repositoryFullName: "fixture/repo",
              commitSha: commit,
              providerMetadata: {},
              actorId: owner,
            },
          });
          await tx.repositoryScanJob.create({
            data: {
              id: jobId,
              assessmentId,
              snapshotId,
              idempotencyKey: jobId,
              triggerSource: RepositoryScanTriggerSource.MANUAL,
              correlationId: jobId,
            },
          });
          await tx.assessmentCase.update({
            where: { assessmentId },
            data: {
              repositoryCommit: commit,
              repositorySnapshotId: snapshotId,
              repositoryScanJobId: jobId,
            },
          });
          await tx.assessmentEvidence.create({
            data: {
              evidenceId,
              assessmentId,
              type: AssessmentEvidenceType.REPOSITORY_SOURCE,
              repositoryCommit: commit,
              contentSha256: `sha256:${"a".repeat(64)}`,
              payload: {},
            },
          });
          const rule = await tx.assessmentRule.findFirstOrThrow({
            where: { ruleSetVersionId: shared.result.ruleSetVersionId },
          });
          await tx.assessmentDecisionCoverage.create({
            data: {
              assessmentId,
              assessmentRuleId: rule.assessmentRuleId,
              ruleSetVersionId: shared.result.ruleSetVersionId,
              assessmentRuleVersion: rule.assessmentRuleVersion,
            },
          });
          await tx.assessmentRuleDecision.create({
            data: {
              decisionId,
              assessmentId,
              ruleSetVersionId: shared.result.ruleSetVersionId,
              assessmentRuleId: rule.assessmentRuleId,
              assessmentRuleVersion: rule.assessmentRuleVersion,
              scopeId: "ASSESSMENT",
              decisionRevision: 1,
              applicability: RuleDecisionApplicability.APPLICABLE,
              compliance: RuleDecisionComplianceOutcome.COMPLIANT,
              repositoryCommit: commit,
              caseRevision: 0,
              idempotencyKey: decisionId,
              requestDigest: "b".repeat(64),
              decision: { references: [{ evidenceId }] },
            },
          });
          await tx.assessmentDecisionCoverage.update({
            where: {
              assessmentId_assessmentRuleId: {
                assessmentId,
                assessmentRuleId: rule.assessmentRuleId,
              },
            },
            data: { resolutionState: DecisionResolutionState.INVESTIGATING },
          });
          const result =
            await new AssessmentEvidenceInvalidation().invalidateEvidenceInTx(
              tx,
              {
                assessmentId,
                evidenceId,
              },
            );
          expect(result.invalidatedDecisionIds).toEqual([decisionId]);
          const coverage =
            await tx.assessmentDecisionCoverage.findUniqueOrThrow({
              where: {
                assessmentId_assessmentRuleId: {
                  assessmentId,
                  assessmentRuleId: rule.assessmentRuleId,
                },
              },
            });
          expect(coverage.resolutionState).toBe(
            DecisionResolutionState.INVALIDATED,
          );
        });
      });

      it("an assessment created before any ACTIVE version waits unpinned instead of starting a preparation", async () => {
        // Hide the ACTIVE pointer inside a rolled-back transaction so nothing persists.
        const before = await runCount();
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.complianceRuleSetVersion.updateMany({
              where: { lifecycleState: ARTIFACT_LIFECYCLE_STATES.ACTIVE },
              data: {
                lifecycleState: ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
                supersededAt: new Date(),
              },
            });
            const id = randomUUID();
            await tx.assessment.create({
              data: { id, ownerId: owner, name: id },
            });
            const pinned = await preparation.createCaseInTx(tx, id);
            expect(pinned.ruleSetVersionId).toBeNull();
            throw new Error("rollback");
          }),
        ).rejects.toThrow("rollback");
        expect(await runCount()).toBe(before);
      });
    });
  },
);
