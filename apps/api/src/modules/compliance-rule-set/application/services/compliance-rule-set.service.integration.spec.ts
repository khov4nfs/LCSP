import { randomUUID } from "node:crypto";
import { ensureMigratedSchema } from "../../../../../test/support/auth-workspace-test-helpers.js";
import { pinFixtureRequest } from "../../../../../test/support/pin-legal-graph-fixture.js";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  PrismaClient,
} from "@prisma/client";
import { ARTIFACT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { LEGAL_SOURCE_CHUNK_STATUSES } from "@lcsp/contracts/legal-source";
import {
  LEGAL_REQUIREMENT_COVERAGE_STATES,
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  COMPLIANCE_RULE_SET_FAILURE_CODES,
  complianceRuleSetReadModelSchema,
  complianceRuleSetSubmitRequestSchema,
  complianceRuleSetValidateRequestSchema,
  ruleSetPreparationClaimRequestSchema,
  ruleSetPreparationLegalSourceBundleSchema,
  ruleSetPreparationFailRequestSchema,
  ruleSetPreparationStartRequestSchema,
  deriveAssessmentApplicabilityGuidance,
} from "@lcsp/contracts/compliance-rule-set";

import {
  FIXTURE_LOCATORS,
  legalSourceFactory,
  ref,
  validPacket,
  withDerivedAssessmentSemantics,
} from "../../../../../test/support/compliance-rule-set-fixtures.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { semanticFidelityPair } from "../../../../../test/support/semantic-fidelity-fixtures.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { ClaimRuleSetPreparationCommand } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { ClaimRuleSetPreparationHandler } from "../commands/claim-rule-set-preparation/claim-rule-set-preparation.handler.js";
import { FailRuleSetPreparationCommand } from "../commands/fail-rule-set-preparation/fail-rule-set-preparation.command.js";
import { FailRuleSetPreparationHandler } from "../commands/fail-rule-set-preparation/fail-rule-set-preparation.handler.js";
import { StartRuleSetPreparationCommand } from "../commands/start-rule-set-preparation/start-rule-set-preparation.command.js";
import { StartRuleSetPreparationHandler } from "../commands/start-rule-set-preparation/start-rule-set-preparation.handler.js";
import { SubmitComplianceRuleSetCommand } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.command.js";
import { SubmitComplianceRuleSetHandler } from "../commands/submit-compliance-rule-set/submit-compliance-rule-set.handler.js";
import { GetActiveComplianceRuleSetHandler } from "../queries/get-active-compliance-rule-set/get-active-compliance-rule-set.handler.js";
import { GetActiveComplianceRuleSetQuery } from "../queries/get-active-compliance-rule-set/get-active-compliance-rule-set.query.js";
import { ValidateComplianceRuleSetHandler } from "../commands/validate-compliance-rule-set/validate-compliance-rule-set.handler.js";
import { ValidateComplianceRuleSetCommand } from "../commands/validate-compliance-rule-set/validate-compliance-rule-set.command.js";
import { LegalSourceSnapshotLoader } from "../../infrastructure/persistence/legal-source-snapshot.service.js";
import { ComplianceRuleSetActivation } from "../../infrastructure/persistence/compliance-rule-set-activation.service.js";
import { ComplianceRuleSetReadModelLoader } from "../../infrastructure/persistence/compliance-rule-set-read-model.service.js";
import {
  reactivationTargetInclude,
  storedRuleSetIntegrityValid,
} from "../../infrastructure/persistence/stored-rule-set-integrity.js";

/**
 * Real PostgreSQL proof of the rule set boundary: atomic activation, one ACTIVE
 * pointer, idempotent replay, failure preserving the previous ACTIVE, rollback and
 * concurrency. Rows are namespaced per run; the immutable tables are never cleaned.
 */
const databaseUrl = process.env.DATABASE_URL ?? "";
const loopback = /@(127\.0\.0\.1|localhost)[:/]/u.test(databaseUrl);
const describeDatabase = databaseUrl && loopback ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

type Body = { body: unknown; correlationId: string };

/**
 * Drives the real handlers exactly as the controller does: the Zod pipe validates the raw body,
 * then one Command/Query handler runs against PostgreSQL.
 */
function buildRuleSetUseCases(
  prisma: PrismaService,
  outbox: OutboxRepository,
  audit: AuditWriterService,
) {
  const parse = <S extends z.ZodTypeAny>(schema: S, body: unknown) =>
    new ZodValidationPipe<z.infer<S>>(
      schema,
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
    ).transform(body);
  const legalSource = new LegalSourceSnapshotLoader(
    prisma,
    new LegalDocumentGraphService(prisma),
  );
  const start = new StartRuleSetPreparationHandler(prisma, outbox);
  const claim = new ClaimRuleSetPreparationHandler(
    prisma,
    new LegalDocumentGraphService(prisma),
  );
  const fail = new FailRuleSetPreparationHandler(prisma);
  const submit = new SubmitComplianceRuleSetHandler(
    prisma,
    legalSource,
    new ComplianceRuleSetActivation(outbox, audit),
  );
  const validate = new ValidateComplianceRuleSetHandler(prisma, legalSource);
  const active = new GetActiveComplianceRuleSetHandler(
    new ComplianceRuleSetReadModelLoader(prisma),
  );
  return {
    startPreparation: async (i: Body & { requestedBy: string }) =>
      start.execute(
        new StartRuleSetPreparationCommand(
          parse(ruleSetPreparationStartRequestSchema, i.body),
          i.requestedBy,
          i.correlationId,
        ),
      ),
    claimPreparation: async (i: Body) =>
      claim.execute(
        new ClaimRuleSetPreparationCommand(
          parse(ruleSetPreparationClaimRequestSchema, i.body),
          i.correlationId,
        ),
      ),
    failPreparation: async (i: Body) =>
      fail.execute(
        new FailRuleSetPreparationCommand(
          parse(ruleSetPreparationFailRequestSchema, i.body),
          i.correlationId,
        ),
      ),
    submit: async (i: Body & { actorId: string }) =>
      submit.execute(
        new SubmitComplianceRuleSetCommand(
          parse(
            complianceRuleSetSubmitRequestSchema,
            await pinFixtureRequest(prisma, i.body),
          ),
          i.actorId,
          i.correlationId,
        ),
      ),
    validate: async (i: Body) =>
      validate.execute(
        new ValidateComplianceRuleSetCommand(
          parse(
            complianceRuleSetValidateRequestSchema,
            await pinFixtureRequest(prisma, i.body),
          ),
          i.correlationId,
        ),
      ),
    getActiveRuleSet: (correlationId: string) =>
      active.execute(new GetActiveComplianceRuleSetQuery(correlationId)),
  };
}

describeDatabase("Legal ruleSet use cases PostgreSQL integration", () => {
  // Graph materialization needs the migration's deferrable parent FK.
  beforeAll(ensureMigratedSchema, 180_000);
  let prisma: PrismaClient;
  let outbox: OutboxRepository;
  let service: ReturnType<typeof buildRuleSetUseCases>;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
    await prisma.$connect();
    createLegalSource = legalSourceFactory(prisma, RUN);
    outbox = new OutboxRepository(prisma as unknown as PrismaService);
    service = buildRuleSetUseCases(
      prisma as unknown as PrismaService,
      outbox,
      new AuditWriterService(prisma as unknown as PrismaService),
    );
  }, 30_000);

  afterAll(async () => {
    // These corpora were ACTIVE only to be preparable; never leave a stray active source behind.
    await prisma.legalSourceVersion.updateMany({
      where: { version: { startsWith: `legalSource-${RUN}-` } },
      data: { status: "SUPERSEDED" },
    });
    await prisma.$disconnect();
  });

  let createLegalSource: ReturnType<typeof legalSourceFactory>;

  async function startRun(legalSourceId: string) {
    return service.startPreparation({
      body: {
        legalSourceVersionId: legalSourceId,
        idempotencyKey: `start-${randomUUID()}`,
      },
      requestedBy: "test-worker",
      correlationId: randomUUID(),
    });
  }

  const submissionClaims = new Map<string, Promise<void>>();
  const claimBeforeSubmit = (preparationRunId: string) => {
    const existing = submissionClaims.get(preparationRunId);
    if (existing) return existing;
    const claim = (async () => {
      const run = await prisma.ruleSetPreparationRun.findUnique({
        where: { id: preparationRunId },
        select: { executionState: true },
      });
      if (run?.executionState === PrismaAgentExecutionState.QUEUED) {
        await service.claimPreparation({
          body: { preparationRunId },
          correlationId: randomUUID(),
        });
      }
    })();
    submissionClaims.set(preparationRunId, claim);
    return claim;
  };
  const submit = async (
    preparationRunId: string,
    packet: unknown,
    idempotencyKey = `submit-${randomUUID()}`,
  ) => {
    await claimBeforeSubmit(preparationRunId);
    return service.submit({
      body: { preparationRunId, idempotencyKey, packet },
      actorId: "test-worker",
      correlationId: randomUUID(),
    });
  };

  /**
   * Other suites rebuild the shared test database with `prisma db push`, which drops the
   * raw-SQL guarantees of the migration (triggers, partial unique index, CHECKs). Those are
   * proven on a migrated database by tests/compliance-rule-set-persistence.mjs, so DB-level
   * assertions here only run when the migration's guards are actually installed.
   */
  const migrationGuardsPresent = async () =>
    (
      await prisma.$queryRaw<
        Array<{ n: number }>
      >`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'LegalRequirement_immutable'`
    )[0]?.n === 1;

  const activeCount = () =>
    prisma.complianceRuleSetVersion.count({
      where: { lifecycleState: "ACTIVE" },
    });

  async function expectProblem(
    promise: Promise<unknown>,
    code: string,
    status: number,
  ) {
    const error = (await promise.then(
      () => null,
      (e: unknown) => e,
    )) as {
      getStatus(): number;
      getResponse(): { problem: { code: string } };
    } | null;
    expect(error).not.toBeNull();
    expect(error!.getStatus()).toBe(status);
    expect(error!.getResponse().problem.code).toBe(code);
  }

  it("activates a valid complete ruleSet atomically and serves it from the single reader", async () => {
    const legalSource = await createLegalSource();
    const run = await startRun(legalSource.id);
    expect(run.executionState).toBe("QUEUED");

    const before = await prisma.complianceRuleSetVersion.findFirst({
      where: { lifecycleState: "ACTIVE" },
    });
    const result = await submit(run.preparationRunId, validPacket());

    expect(result).toMatchObject({
      lifecycleState: "ACTIVE",
      validation: { outcome: "PASSED", failures: [] },
      previousActiveRuleSetVersionId: before?.id ?? null,
      replayed: false,
    });
    expect(await activeCount()).toBe(1);

    const ruleSet = await prisma.complianceRuleSetVersion.findUniqueOrThrow({
      where: { id: result.ruleSetVersionId },
      include: {
        rules: true,
        assessmentRules: true,
        provenance: true,
        contextRelations: true,
      },
    });
    expect(ruleSet.legalSourceVersionId).toBe(legalSource.id);
    expect(ruleSet.rules).toHaveLength(5);
    expect(ruleSet.assessmentRules).toHaveLength(3);
    expect(ruleSet.contextRelations).toHaveLength(2);
    expect(ruleSet.provenance.length).toBeGreaterThanOrEqual(7);
    expect(
      (
        await prisma.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe("SUCCEEDED");

    const events = await prisma.outboxMessage.findMany({
      where: { aggregateId: result.ruleSetVersionId },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetActivated,
    ]);
    expect(
      await prisma.auditEvent.count({
        where: {
          resourceId: result.ruleSetVersionId,
          eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetActivated,
        },
      }),
    ).toBe(1);

    if (before) {
      expect(
        (
          await prisma.complianceRuleSetVersion.findUniqueOrThrow({
            where: { id: before.id },
          })
        ).lifecycleState,
      ).toBe("SUPERSEDED");
    }

    const read = complianceRuleSetReadModelSchema.parse(
      await service.getActiveRuleSet(randomUUID()),
    );
    expect(read.ruleSetVersionId).toBe(result.ruleSetVersionId);
    expect(read.claimInventory?.revision).toBe(1);
    expect(
      read.legalRequirements.every((r) => r.claimInventoryRevision === 1),
    ).toBe(true);
    expect(read.legalSourceVersionId).toBe(legalSource.id);
    expect(read.legalRequirements).toHaveLength(5);
    expect(
      read.assessmentRules.map((rule) => rule.assessmentRuleId).sort(),
    ).toEqual(["ER-DEF", "ER-RET", "ER-XREF"]);
    expect(read.assessmentRules.every((rule) => rule.sources.length > 0)).toBe(
      true,
    );
    const person = read.legalRequirements.find(
      (rule) => rule.legalRequirementId === "LR-PERSON",
    );
    expect(person?.nonRepositoryDuty).toBe(true);
    expect(person?.coverage.state).toBe("NON_ASSESSABLE");
  });

  it("derives omitted applicability once and preserves parent roles through persistence and the reader", async () => {
    const source = await createLegalSource();
    const run = await startRun(source.id);
    const packet = validPacket();
    const parent = packet.legalRequirements[0];
    parent.operativePropositions![0].actor =
      "Organization A remains the obligation holder";
    parent.applicabilityConditions = [
      "Organization A delegates fulfillment to Organization B, which performs on behalf of A without releasing A",
    ];
    parent.qualifiers = [
      "Only actions intended to prevent the defined transfer",
    ];
    parent.exceptions = [
      "Only while a documented specific security threat exists",
    ];
    packet.assessmentRules[0].criteria[0].investigationFocus =
      "Repository billing endpoint only";
    withDerivedAssessmentSemantics(packet);
    const input = {
      ...packet,
      assessmentRules: packet.assessmentRules.map(
        ({
          applicabilityGuidance,
          legalIntent,
          contextRelationIds,
          unresolvedConditions,
          ...rule
        }) => {
          void applicabilityGuidance;
          void legalIntent;
          void contextRelationIds;
          void unresolvedConditions;
          return {
            ...rule,
            criteria: rule.criteria.map(({ statement, ...criterion }) => {
              void statement;
              return criterion;
            }),
          };
        },
      ),
    };
    const accepted = await submit(run.preparationRunId, input);
    expect(accepted.validation.failures).toEqual([]);
    const stored = await prisma.assessmentRule.findFirstOrThrow({
      where: {
        ruleSetVersionId: accepted.ruleSetVersionId,
        assessmentRuleId: "ER-DEF",
      },
    });
    const expected = deriveAssessmentApplicabilityGuidance([parent]);
    expect(stored.applicabilityGuidance).toBe(expected);
    expect(stored.criteria).toEqual([
      {
        criterionId: "C-1",
        legalRequirementIds: [parent.legalRequirementId],
        statement: expected,
        investigationFocus: "Repository billing endpoint only",
      },
    ]);
    expect(
      (stored.contract as Record<string, unknown>).applicabilityGuidance,
    ).toBe(expected);
    const read = await service.getActiveRuleSet(randomUUID());
    expect(
      read.assessmentRules.find((rule) => rule.assessmentRuleId === "ER-DEF")
        ?.applicabilityGuidance,
    ).toBe(expected);
    expect(
      read.assessmentRules.find((rule) => rule.assessmentRuleId === "ER-DEF")
        ?.criteria,
    ).toEqual(stored.criteria);
  });

  it("persists inherited dependency direction and unresolved fact identity through the read model", async () => {
    const source = await createLegalSource();
    const run = await startRun(source.id);
    const packet = semanticFidelityPair();
    const result = await submit(run.preparationRunId, packet);
    expect(result.validation.failures).toEqual([]);
    const read = await service.getActiveRuleSet(randomUUID());
    const expected = packet.assessmentRules[0];
    const actual = read.assessmentRules.find(
      (rule) => rule.assessmentRuleId === expected.assessmentRuleId,
    )!;
    expect(actual.contextRelationIds).toEqual(expected.contextRelationIds);
    expect(actual.unresolvedConditionBindings).toEqual(
      expected.unresolvedConditionBindings,
    );
    expect(actual.unresolvedConditions).toEqual(expected.unresolvedConditions);
    expect(actual.criteria).toEqual(expected.criteria);
    expect(actual.legalIntent).toEqual(expected.legalIntent);
    expect(read.semanticGraph?.claims.length).toBeGreaterThan(0);
    const accepted = await prisma.complianceRuleSetVersion.findUniqueOrThrow({
      where: { id: result.ruleSetVersionId },
      include: reactivationTargetInclude,
    });
    const chunks = await prisma.legalDocumentChunk.findMany({
      where: { legalSourceVersionId: source.id },
    });
    expect(storedRuleSetIntegrityValid(accepted, chunks)).toBe(true);
    await expect(
      prisma.legalSemanticClaim.updateMany({
        where: { ruleSetVersionId: result.ruleSetVersionId },
        data: { statement: "mutated" },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.legalRequirementClaimBinding.deleteMany({
        where: { ruleSetVersionId: result.ruleSetVersionId },
      }),
    ).rejects.toThrow();
  });
  it("persists and verifies claim-to-node lineage without requiring legacy chunk citations", async () => {
    const source = await createLegalSource();
    const run = await startRun(source.id);
    const packet = validPacket();
    packet.legalRequirements.forEach((r) => {
      r.sourceRefs = [];
      r.operativePropositions!.forEach((p) => {
        p.sourceRefs = [];
      });
    });
    packet.assessmentRules.forEach((r) => {
      r.sourceRefs = [];
    });
    packet.contextRelations = packet.contextRelations.filter(
      (r) => !r.toSourceRef,
    );
    const candidate = complianceRuleSetSubmitRequestSchema.shape.packet.parse({
      ...packet,
      assessmentRules: packet.assessmentRules.map((r) => ({
        ...r,
        legalIntent: undefined,
        applicabilityGuidance: undefined,
        contextRelationIds: undefined,
        requiredEvidence: [],
        supportingEvidence: [],
        negativeEvidence: [],
        investigationGoals: [],
        criteria: r.criteria.map((c) => ({ ...c, statement: undefined })),
      })),
    });
    const result = await submit(run.preparationRunId, candidate);
    expect(result.validation.failures).toEqual([]);
    const accepted = await prisma.complianceRuleSetVersion.findUniqueOrThrow({
      where: { id: result.ruleSetVersionId },
      include: reactivationTargetInclude,
    });
    expect(
      accepted.rules.every(
        (r) => r.provenance.length === 0 && r.claimBindings.length > 0,
      ),
    ).toBe(true);
    expect(storedRuleSetIntegrityValid(accepted, [])).toBe(true);
    const read = await service.getActiveRuleSet(randomUUID());
    expect(read.semanticGraph!.claims.length).toBe(
      candidate.semanticGraph!.claims.length,
    );
    expect(read.legalRequirements.every((r) => r.sources.length === 0)).toBe(
      true,
    );
  });

  it("reports contradictory downstream guidance as a deterministic gap before canonical submission", async () => {
    const source = await createLegalSource();
    const run = await startRun(source.id);
    const packet = validPacket();
    packet.legalRequirements[0].applicabilityConditions = [
      "Organization A delegates fulfillment to Organization B",
    ];
    packet.assessmentRules[0].applicabilityGuidance =
      "Organization B delegates fulfillment to Organization A";
    const result = await service.validate({
      body: { preparationRunId: run.preparationRunId, packet },
      correlationId: randomUUID(),
    });
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        code: COMPLIANCE_RULE_SET_FAILURE_CODES.APPLICABILITY_BINDING_MISMATCH,
        ref: "assessmentRule:ER-DEF",
      }),
    );
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(0);
  });

  it("replays the same idempotency key without a second activation, audit row or event", async () => {
    const legalSource = await createLegalSource();
    const run = await startRun(legalSource.id);
    const key = `submit-${randomUUID()}`;
    const first = await submit(run.preparationRunId, validPacket(), key);
    const second = await submit(run.preparationRunId, validPacket(), key);

    expect(second).toMatchObject({
      ruleSetVersionId: first.ruleSetVersionId,
      replayed: true,
    });
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxMessage.count({
        where: { aggregateId: first.ruleSetVersionId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { resourceId: first.ruleSetVersionId },
      }),
    ).toBe(1);
  });

  it("rejects the same key with a different packet and a consumed run with a new key", async () => {
    const legalSource = await createLegalSource();
    const run = await startRun(legalSource.id);
    const key = `submit-${randomUUID()}`;
    await submit(run.preparationRunId, validPacket(), key);

    const other = validPacket();
    other.legalRequirements[0].title = "Changed";
    await expectProblem(
      submit(run.preparationRunId, other, key),
      COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
      409,
    );
    await expectProblem(
      submit(run.preparationRunId, validPacket()),
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      409,
    );
  });

  it("an invalid packet records the failure, leaves the previous ACTIVE untouched and writes no children", async () => {
    const good = await submit(
      (await startRun((await createLegalSource()).id)).preparationRunId,
      validPacket(),
    );
    const activeBefore = await prisma.complianceRuleSetVersion.findFirstOrThrow(
      {
        where: { lifecycleState: "ACTIVE" },
      },
    );
    expect(activeBefore.id).toBe(good.ruleSetVersionId);

    const legalSource = await createLegalSource();
    const run = await startRun(legalSource.id);
    const bad = validPacket();
    bad.legalRequirements[0].sourceRefs.push({
      ...ref("art-1::cl-1"),
      locator: "art-99::cl-1",
    }); // fake reference
    bad.legalRequirements.push({ ...bad.legalRequirements[1] }); // duplicate rule id
    const result = await submit(run.preparationRunId, bad);

    expect(result.lifecycleState).toBe("INVALID");
    expect(result.validation.outcome).toBe("FAILED");
    expect(result.validation.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        COMPLIANCE_RULE_SET_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE,
        COMPLIANCE_RULE_SET_FAILURE_CODES.DUPLICATE_RULE_ID,
      ]),
    );
    expect(result.previousActiveRuleSetVersionId).toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { resourceId: result.ruleSetVersionId },
    });
    expect(JSON.stringify(audit.payload)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE,
    );
    expect(
      (
        await prisma.complianceRuleSetVersion.findFirstOrThrow({
          where: { lifecycleState: "ACTIVE" },
        })
      ).id,
    ).toBe(good.ruleSetVersionId);
    expect(await activeCount()).toBe(1);
    expect(
      await prisma.legalRequirement.count({
        where: { ruleSetVersionId: result.ruleSetVersionId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe("FAILED");
    const record =
      await prisma.complianceRuleSetActivationRecord.findUniqueOrThrow({
        where: { ruleSetVersionId: result.ruleSetVersionId },
      });
    expect(record.validationOutcome).toBe("FAILED");
    expect(
      (
        await prisma.outboxMessage.findMany({
          where: { aggregateId: result.ruleSetVersionId },
        })
      ).map((e) => e.eventType),
    ).toEqual([COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetValidationFailed]);
  });

  it("rejects stale and mixed-version source claims against the pinned legalSource", async () => {
    await createLegalSource(true); // another legalSource version where art-5::cl-1 differs
    const pinned = await createLegalSource();
    const run = await startRun(pinned.id);
    const mixed = validPacket();
    mixed.legalRequirements[1].sourceRefs.push(ref("art-5::cl-1", "v2"));
    const result = await submit(run.preparationRunId, mixed);
    expect(result.validation.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        COMPLIANCE_RULE_SET_FAILURE_CODES.STALE_SOURCE_HASH,
        COMPLIANCE_RULE_SET_FAILURE_CODES.MIXED_SOURCE_VERSION,
      ]),
    );
    expect(result.lifecycleState).toBe("INVALID");
  });

  it("fails closed when the pinned legalSource has no valid retrieval index", async () => {
    const legalSource = await createLegalSource();
    await prisma.legalRetrievalIndex.updateMany({
      where: { legalSourceVersionId: legalSource.id },
      data: { status: "BUILDING", validatedAt: null },
    });
    const result = await submit(
      (await startRun(legalSource.id)).preparationRunId,
      validPacket(),
    );
    expect(result.validation.failures.map((f) => f.code)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.RETRIEVAL_INDEX_NOT_VALID,
    );
  });

  it("supersedes the previous ACTIVE and keeps its rows immutable and readable (pins never retarget)", async () => {
    const first = await submit(
      (await startRun((await createLegalSource()).id)).preparationRunId,
      validPacket(),
    );
    const firstRules = await prisma.legalRequirement.count({
      where: { ruleSetVersionId: first.ruleSetVersionId },
    });
    const second = await submit(
      (await startRun((await createLegalSource()).id)).preparationRunId,
      validPacket(),
    );

    expect(second.previousActiveRuleSetVersionId).toBe(first.ruleSetVersionId);
    expect(await activeCount()).toBe(1);
    const old = await prisma.complianceRuleSetVersion.findUniqueOrThrow({
      where: { id: first.ruleSetVersionId },
    });
    expect(old.lifecycleState).toBe("SUPERSEDED");
    expect(old.supersededAt).not.toBeNull();
    expect(
      await prisma.legalRequirement.count({
        where: { ruleSetVersionId: first.ruleSetVersionId },
      }),
    ).toBe(firstRules);
    if (await migrationGuardsPresent()) {
      await expect(
        prisma.legalRequirement.updateMany({
          where: { ruleSetVersionId: first.ruleSetVersionId },
          data: { title: "tamper" },
        }),
      ).rejects.toThrow(/immutable/u);
    }
  });

  it("serializes concurrent submissions: exactly one ACTIVE and a consistent supersession chain", async () => {
    const runs = await Promise.all(
      [1, 2, 3].map(async () => startRun((await createLegalSource()).id)),
    );
    const results = await Promise.all(
      runs.map((run) => submit(run.preparationRunId, validPacket())),
    );

    expect(await activeCount()).toBe(1);
    const active = await prisma.complianceRuleSetVersion.findFirstOrThrow({
      where: { lifecycleState: "ACTIVE" },
    });
    expect(results.map((r) => r.ruleSetVersionId)).toContain(active.id);
    const previous = results
      .map((r) => r.previousActiveRuleSetVersionId)
      .filter(Boolean);
    // Each newer activation names a different predecessor: no two share one.
    expect(new Set(previous).size).toBe(previous.length);
    expect(results.every((r) => r.lifecycleState === "ACTIVE")).toBe(true);
  });

  it("returns one result for the same idempotency key submitted concurrently", async () => {
    const run = await startRun((await createLegalSource()).id);
    const key = `submit-${randomUUID()}`;
    const [a, b] = await Promise.all([
      submit(run.preparationRunId, validPacket(), key),
      submit(run.preparationRunId, validPacket(), key),
    ]);
    expect(a.ruleSetVersionId).toBe(b.ruleSetVersionId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(1);
  });

  it("rolls the whole activation back when any in-transaction write fails", async () => {
    const baseline = await submit(
      (await startRun((await createLegalSource()).id)).preparationRunId,
      validPacket(),
    );
    const run = await startRun((await createLegalSource()).id);
    const spy = jest
      .spyOn(outbox, "enqueue")
      .mockRejectedValueOnce(new Error("outbox unavailable"));

    await expect(submit(run.preparationRunId, validPacket())).rejects.toThrow(
      /outbox unavailable/u,
    );
    spy.mockRestore();

    expect(
      (
        await prisma.complianceRuleSetVersion.findFirstOrThrow({
          where: { lifecycleState: "ACTIVE" },
        })
      ).id,
    ).toBe(baseline.ruleSetVersionId);
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe(PrismaAgentExecutionState.RUNNING);
    // the same request is safely retryable afterwards
    const retried = await submit(run.preparationRunId, validPacket());
    expect(retried.lifecycleState).toBe("ACTIVE");
  });

  it("validates the request shape at the trust boundary", async () => {
    const run = await startRun((await createLegalSource()).id);
    const withAuthority = {
      ...validPacket(),
      ruleSetVersionId: randomUUID(),
    };
    await expectProblem(
      submit(run.preparationRunId, withAuthority),
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      400,
    );
    await expectProblem(
      submit(randomUUID(), validPacket()),
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
      404,
    );
  });

  it("rejects a coverage-invalid packet at the shared contract as a 400 before anything is persisted", async () => {
    const run = await startRun((await createLegalSource()).id);
    const covered = validPacket();
    covered.legalRequirements[0].coverage = {
      state: LEGAL_REQUIREMENT_COVERAGE_STATES.COVERED_BY_ASSESSMENT_RULES,
      nonAssessableReason: "stray reason",
    };
    const blank = validPacket();
    blank.legalRequirements[0].coverage = {
      state: LEGAL_REQUIREMENT_COVERAGE_STATES.NON_ASSESSABLE,
      nonAssessableReason: "  ",
    };
    for (const packet of [covered, blank]) {
      await expectProblem(
        submit(run.preparationRunId, packet),
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        400,
      );
    }
    expect(
      await prisma.complianceRuleSetVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(0);
  });

  it("keeps the coverage CHECK as database defense-in-depth beside the contract", async () => {
    if (!(await migrationGuardsPresent())) return;
    const rows = await prisma.$queryRaw<
      Array<{ definition: string }>
    >`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'LegalRequirement_coverage_reason_check'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].definition).toEqual(
      expect.stringContaining("COVERED_BY_ASSESSMENT_RULES"),
    );
    expect(rows[0].definition).toEqual(
      expect.stringContaining("NON_ASSESSABLE"),
    );
    expect(rows[0].definition).toEqual(expect.stringContaining("IS NULL"));
    expect(rows[0].definition).toEqual(expect.stringContaining("IS NOT NULL"));
    expect(rows[0].definition).toEqual(expect.stringContaining("btrim"));
  });

  it("rejects contradictory declared coverage before persistence and still accepts a valid packet", async () => {
    const run = await startRun((await createLegalSource()).id);
    const nonAssessable = validPacket();
    nonAssessable.assessmentRules[1].legalRequirementIds.push(
      nonAssessable.legalRequirements[4].legalRequirementId,
    );
    const uncovered = validPacket();
    uncovered.assessmentRules[1].legalRequirementIds.pop();
    const before = await Promise.all([
      prisma.complianceRuleSetVersion.count(),
      prisma.legalRequirement.count(),
      prisma.assessmentRule.count(),
    ]);
    for (const packet of [nonAssessable, uncovered]) {
      await expectProblem(
        submit(run.preparationRunId, packet),
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        400,
      );
      await expectProblem(
        service.validate({
          body: { preparationRunId: run.preparationRunId, packet },
          correlationId: randomUUID(),
        }),
        COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
        400,
      );
    }
    expect(
      await Promise.all([
        prisma.complianceRuleSetVersion.count(),
        prisma.legalRequirement.count(),
        prisma.assessmentRule.count(),
      ]),
    ).toEqual(before);
    const accepted = await submit(run.preparationRunId, validPacket());
    expect(accepted.lifecycleState).toBe(ARTIFACT_LIFECYCLE_STATES.ACTIVE);
  });

  it("claims a run (QUEUED -> RUNNING) and serves only its pinned legalSource", async () => {
    const legalSource = await createLegalSource();
    await createLegalSource(true); // an unrelated legalSource must never appear in the bundle
    const run = await startRun(legalSource.id);

    const bundle = await service.claimPreparation({
      body: { preparationRunId: run.preparationRunId },
      correlationId: randomUUID(),
    });
    expect(
      ruleSetPreparationLegalSourceBundleSchema.safeParse(bundle).success,
    ).toBe(true);
    expect(bundle.executionState).toBe("RUNNING");
    expect(bundle.legalSourceVersionId).toBe(legalSource.id);
    expect(bundle.documents).toHaveLength(1);
    expect(bundle.documents[0].chunks.map((c) => c.locator)).toEqual(
      [...FIXTURE_LOCATORS].sort(),
    );
    expect(
      bundle.documents[0].chunks.map((chunk) => [
        chunk.legalEffectStatus,
        chunk.legalStatusSourceRef,
      ]),
    ).toEqual(
      [...FIXTURE_LOCATORS]
        .sort()
        .map(() => [
          LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
          "source-metadata:fixture",
        ]),
    );
    expect(
      (
        await prisma.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).startedAt,
    ).not.toBeNull();

    // a duplicated or redelivered command must never claim the same run twice (no second paid run)
    await expectProblem(
      service.claimPreparation({
        body: { preparationRunId: run.preparationRunId },
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      409,
    );

    await submit(run.preparationRunId, validPacket());
    await expectProblem(
      service.claimPreparation({
        body: { preparationRunId: run.preparationRunId },
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      409,
    );
    await expectProblem(
      service.claimPreparation({
        body: { preparationRunId: randomUUID() },
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
      404,
    );
  });

  it("validates against a frozen inventory without publishing Rule artifacts", async () => {
    const source = await createLegalSource();
    await new LegalDocumentGraphService(prisma as PrismaService).materialize(
      source.id,
    );
    const run = await startRun(source.id);
    const before = await prisma.complianceRuleSetVersion.count();
    const bad = validPacket();
    bad.assessmentRules[0].legalRequirementIds.push("LR-MISSING");

    await claimBeforeSubmit(run.preparationRunId);
    const failed = await service.validate({
      body: { preparationRunId: run.preparationRunId, packet: bad },
      correlationId: randomUUID(),
    });
    expect(failed.outcome).toBe("FAILED");
    expect(failed.failures.map((f) => f.code)).toContain(
      COMPLIANCE_RULE_SET_FAILURE_CODES.ORPHAN_ASSESSMENT_RULE,
    );
    const passed = await service.validate({
      body: { preparationRunId: run.preparationRunId, packet: validPacket() },
      correlationId: randomUUID(),
    });
    expect(passed).toMatchObject({ outcome: "PASSED", failures: [] });
    expect(passed.coverage!.semanticClaims.unaccounted).toBe(0);

    expect(await prisma.complianceRuleSetVersion.count()).toBe(before);
    expect(
      (
        await prisma.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe("RUNNING");
  });

  it("records an execution failure once and refuses to fail a finished run", async () => {
    const run = await startRun((await createLegalSource()).id);
    const body = {
      preparationRunId: run.preparationRunId,
      reason: "NO_SUBMISSION",
    };
    const failed = await service.failPreparation({
      body,
      correlationId: randomUUID(),
    });
    expect(failed.executionState).toBe("FAILED");
    expect(
      (
        await prisma.ruleSetPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).failureReason,
    ).toBe("NO_SUBMISSION");
    expect(
      (await service.failPreparation({ body, correlationId: randomUUID() }))
        .executionState,
    ).toBe("FAILED");
    await expectProblem(
      service.claimPreparation({
        body: { preparationRunId: run.preparationRunId },
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      409,
    );

    const done = await startRun((await createLegalSource()).id);
    await submit(done.preparationRunId, validPacket());
    await expectProblem(
      service.failPreparation({
        body: {
          preparationRunId: done.preparationRunId,
          reason: "RUNTIME_ERROR",
        },
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
      409,
    );
    await expectProblem(
      service.failPreparation({
        body: {
          preparationRunId: done.preparationRunId,
          reason: "NOT_A_REASON",
        },
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
      400,
    );
  });

  it("starts a preparation run idempotently and enqueues one command", async () => {
    const legalSource = await createLegalSource();
    const other = await createLegalSource();
    const key = `start-${randomUUID()}`;
    const body = { legalSourceVersionId: legalSource.id, idempotencyKey: key };
    const a = await service.startPreparation({
      body,
      requestedBy: "w",
      correlationId: randomUUID(),
    });
    const b = await service.startPreparation({
      body,
      requestedBy: "w",
      correlationId: randomUUID(),
    });
    expect(b.preparationRunId).toBe(a.preparationRunId);
    expect(
      await prisma.outboxMessage.count({
        where: {
          aggregateId: legalSource.id,
          eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.preparationRequested,
        },
      }),
    ).toBe(1);
    await expectProblem(
      service.startPreparation({
        body: { legalSourceVersionId: other.id, idempotencyKey: key },
        requestedBy: "w",
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
      409,
    );
    await expectProblem(
      service.startPreparation({
        body: {
          legalSourceVersionId: randomUUID(),
          idempotencyKey: `start-${randomUUID()}`,
        },
        requestedBy: "w",
        correlationId: randomUUID(),
      }),
      COMPLIANCE_RULE_SET_ERROR_CODES.sourceVersionNotFound,
      404,
    );
  });
});
import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";
