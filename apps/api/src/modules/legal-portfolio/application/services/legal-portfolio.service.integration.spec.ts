import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import type { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  LEGAL_PORTFOLIO_EVENT_TYPES,
  LEGAL_PORTFOLIO_FAILURE_CODES,
  legalPortfolioReadModelSchema,
  legalPortfolioSubmitRequestSchema,
  legalPortfolioValidateRequestSchema,
  legalPreparationClaimRequestSchema,
  legalPreparationCorpusBundleSchema,
  legalPreparationFailRequestSchema,
  legalPreparationStartRequestSchema,
} from "@lcsp/contracts/legal-portfolio";

import {
  FIXTURE_DOCUMENT_ID,
  FIXTURE_LOCATORS,
  fixtureHash,
  ref,
  validPacket,
} from "../../../../../test/support/legal-portfolio-fixtures.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { ClaimLegalPreparationCommand } from "../commands/claim-legal-preparation/claim-legal-preparation.command.js";
import { ClaimLegalPreparationHandler } from "../commands/claim-legal-preparation/claim-legal-preparation.handler.js";
import { FailLegalPreparationCommand } from "../commands/fail-legal-preparation/fail-legal-preparation.command.js";
import { FailLegalPreparationHandler } from "../commands/fail-legal-preparation/fail-legal-preparation.handler.js";
import { StartLegalPreparationCommand } from "../commands/start-legal-preparation/start-legal-preparation.command.js";
import { StartLegalPreparationHandler } from "../commands/start-legal-preparation/start-legal-preparation.handler.js";
import { SubmitLegalPortfolioCommand } from "../commands/submit-legal-portfolio/submit-legal-portfolio.command.js";
import { SubmitLegalPortfolioHandler } from "../commands/submit-legal-portfolio/submit-legal-portfolio.handler.js";
import { GetActiveLegalPortfolioHandler } from "../queries/get-active-legal-portfolio/get-active-legal-portfolio.handler.js";
import { GetActiveLegalPortfolioQuery } from "../queries/get-active-legal-portfolio/get-active-legal-portfolio.query.js";
import { ValidateLegalPortfolioHandler } from "../queries/validate-legal-portfolio/validate-legal-portfolio.handler.js";
import { ValidateLegalPortfolioQuery } from "../queries/validate-legal-portfolio/validate-legal-portfolio.query.js";
import { LegalCorpusSnapshotLoader } from "../../infrastructure/persistence/legal-corpus-snapshot.service.js";
import { LegalPortfolioActivation } from "../../infrastructure/persistence/legal-portfolio-activation.service.js";
import { LegalPortfolioReadModelLoader } from "../../infrastructure/persistence/legal-portfolio-read-model.service.js";

/**
 * Real PostgreSQL proof of the portfolio boundary: atomic activation, one ACTIVE
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
function buildPortfolioUseCases(
  prisma: PrismaService,
  outbox: OutboxRepository,
  audit: AuditWriterService,
) {
  const parse = <S extends z.ZodTypeAny>(schema: S, body: unknown) =>
    new ZodValidationPipe<z.infer<S>>(
      schema,
      LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
    ).transform(body);
  const corpus = new LegalCorpusSnapshotLoader(prisma);
  const start = new StartLegalPreparationHandler(prisma, outbox);
  const claim = new ClaimLegalPreparationHandler(prisma);
  const fail = new FailLegalPreparationHandler(prisma);
  const submit = new SubmitLegalPortfolioHandler(
    prisma,
    corpus,
    new LegalPortfolioActivation(outbox, audit),
  );
  const validate = new ValidateLegalPortfolioHandler(prisma, corpus);
  const active = new GetActiveLegalPortfolioHandler(
    new LegalPortfolioReadModelLoader(prisma),
  );
  return {
    startPreparation: async (i: Body & { requestedBy: string }) =>
      start.execute(
        new StartLegalPreparationCommand(
          parse(legalPreparationStartRequestSchema, i.body),
          i.requestedBy,
          i.correlationId,
        ),
      ),
    claimPreparation: async (i: Body) =>
      claim.execute(
        new ClaimLegalPreparationCommand(
          parse(legalPreparationClaimRequestSchema, i.body),
          i.correlationId,
        ),
      ),
    failPreparation: async (i: Body) =>
      fail.execute(
        new FailLegalPreparationCommand(
          parse(legalPreparationFailRequestSchema, i.body),
          i.correlationId,
        ),
      ),
    submit: async (i: Body & { actorId: string }) =>
      submit.execute(
        new SubmitLegalPortfolioCommand(
          parse(legalPortfolioSubmitRequestSchema, i.body),
          i.actorId,
          i.correlationId,
        ),
      ),
    validate: async (i: Body) =>
      validate.execute(
        new ValidateLegalPortfolioQuery(
          parse(legalPortfolioValidateRequestSchema, i.body),
          i.correlationId,
        ),
      ),
    getActivePortfolio: (correlationId: string) =>
      active.execute(new GetActiveLegalPortfolioQuery(correlationId)),
  };
}

describeDatabase("Legal portfolio use cases PostgreSQL integration", () => {
  let prisma: PrismaClient;
  let outbox: OutboxRepository;
  let service: ReturnType<typeof buildPortfolioUseCases>;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
    await prisma.$connect();
    outbox = new OutboxRepository(prisma as unknown as PrismaService);
    service = buildPortfolioUseCases(
      prisma as unknown as PrismaService,
      outbox,
      new AuditWriterService(prisma as unknown as PrismaService),
    );
  }, 30_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let counter = 0;
  /** A corpus mirroring the fixture hierarchy; `changed` alters art-5::cl-1 (version 2). */
  async function createCorpus(changed = false) {
    counter += 1;
    const tag = `${RUN}-${counter}`;
    const corpus = await prisma.legalCorpusVersion.create({
      data: {
        version: `corpus-${tag}`,
        status: "SUPERSEDED",
        sourceManifest: {},
      },
    });
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalCorpusVersionId: corpus.id,
        documentId: FIXTURE_DOCUMENT_ID,
        title: "Synthetic notice",
        sourceUrl: "https://example.invalid/notice",
        sourceSha256: "a".repeat(64),
        sourceEffectStatus: "IN_FORCE",
      },
    });
    await prisma.legalDocumentChunk.createMany({
      data: FIXTURE_LOCATORS.map((locator) => ({
        id: `${tag}-${locator}`,
        legalCorpusVersionId: corpus.id,
        legalSourceDocumentId: document.id,
        documentId: FIXTURE_DOCUMENT_ID,
        locator,
        content: `content ${locator}`,
        contentSha256: fixtureHash(
          locator,
          changed && locator === "art-5::cl-1" ? "v2" : "v1",
        ),
        hierarchy: {},
        legalStatus: "IN_FORCE",
      })),
    });
    await prisma.legalRetrievalIndex.create({
      data: {
        legalCorpusVersionId: corpus.id,
        version: `index-${tag}`,
        status: "VALID",
        configHash: "c".repeat(64),
        contentHash: "d".repeat(64),
        validationManifestRef: `manifest:${tag}`,
        validatedAt: new Date(),
      },
    });
    return corpus;
  }

  async function startRun(corpusId: string) {
    return service.startPreparation({
      body: {
        legalCorpusVersionId: corpusId,
        idempotencyKey: `start-${randomUUID()}`,
      },
      requestedBy: "test-worker",
      correlationId: randomUUID(),
    });
  }

  const submit = (
    preparationRunId: string,
    packet: unknown,
    idempotencyKey = `submit-${randomUUID()}`,
  ) =>
    service.submit({
      body: { preparationRunId, idempotencyKey, packet },
      actorId: "test-worker",
      correlationId: randomUUID(),
    });

  /**
   * Other suites rebuild the shared test database with `prisma db push`, which drops the
   * raw-SQL guarantees of the migration (triggers, partial unique index, CHECKs). Those are
   * proven on a migrated database by tests/legal-portfolio-persistence.mjs, so DB-level
   * assertions here only run when the migration's guards are actually installed.
   */
  const migrationGuardsPresent = async () =>
    (
      await prisma.$queryRaw<
        Array<{ n: number }>
      >`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'LegalPortfolioRule_immutable'`
    )[0]?.n === 1;

  const activeCount = () =>
    prisma.legalPortfolioVersion.count({ where: { lifecycleState: "ACTIVE" } });

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

  it("activates a valid complete portfolio atomically and serves it from the single reader", async () => {
    const corpus = await createCorpus();
    const run = await startRun(corpus.id);
    expect(run.executionState).toBe("QUEUED");

    const before = await prisma.legalPortfolioVersion.findFirst({
      where: { lifecycleState: "ACTIVE" },
    });
    const result = await submit(run.preparationRunId, validPacket());

    expect(result).toMatchObject({
      lifecycleState: "ACTIVE",
      validation: { outcome: "PASSED", failures: [] },
      previousActivePortfolioVersionId: before?.id ?? null,
      replayed: false,
    });
    expect(await activeCount()).toBe(1);

    const portfolio = await prisma.legalPortfolioVersion.findUniqueOrThrow({
      where: { id: result.portfolioVersionId },
      include: {
        rules: true,
        engineeringRules: true,
        provenance: true,
        contextRelations: true,
      },
    });
    expect(portfolio.legalCorpusVersionId).toBe(corpus.id);
    expect(portfolio.rules).toHaveLength(5);
    expect(portfolio.engineeringRules).toHaveLength(3);
    expect(portfolio.contextRelations).toHaveLength(2);
    expect(portfolio.provenance.length).toBeGreaterThanOrEqual(7);
    expect(
      (
        await prisma.legalPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe("SUCCEEDED");

    const events = await prisma.outboxMessage.findMany({
      where: { aggregateId: result.portfolioVersionId },
    });
    expect(events.map((e) => e.eventType)).toEqual([
      LEGAL_PORTFOLIO_EVENT_TYPES.portfolioActivated,
    ]);
    expect(
      await prisma.auditEvent.count({
        where: {
          resourceId: result.portfolioVersionId,
          eventType: LEGAL_PORTFOLIO_EVENT_TYPES.portfolioActivated,
        },
      }),
    ).toBe(1);

    if (before) {
      expect(
        (
          await prisma.legalPortfolioVersion.findUniqueOrThrow({
            where: { id: before.id },
          })
        ).lifecycleState,
      ).toBe("SUPERSEDED");
    }

    const read = legalPortfolioReadModelSchema.parse(
      await service.getActivePortfolio(randomUUID()),
    );
    expect(read.portfolioVersionId).toBe(result.portfolioVersionId);
    expect(read.legalCorpusVersionId).toBe(corpus.id);
    expect(read.legalRules).toHaveLength(5);
    expect(
      read.engineeringRules.map((rule) => rule.engineeringRuleId).sort(),
    ).toEqual(["ER-DEF", "ER-RET", "ER-XREF"]);
    expect(read.engineeringRules.every((rule) => rule.sources.length > 0)).toBe(
      true,
    );
    const person = read.legalRules.find(
      (rule) => rule.legalRuleId === "LR-PERSON",
    );
    expect(person?.nonRepositoryDuty).toBe(true);
    expect(person?.coverage.state).toBe("NON_ASSESSABLE");
  });

  it("replays the same idempotency key without a second activation, audit row or event", async () => {
    const corpus = await createCorpus();
    const run = await startRun(corpus.id);
    const key = `submit-${randomUUID()}`;
    const first = await submit(run.preparationRunId, validPacket(), key);
    const second = await submit(run.preparationRunId, validPacket(), key);

    expect(second).toMatchObject({
      portfolioVersionId: first.portfolioVersionId,
      replayed: true,
    });
    expect(
      await prisma.legalPortfolioVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxMessage.count({
        where: { aggregateId: first.portfolioVersionId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { resourceId: first.portfolioVersionId },
      }),
    ).toBe(1);
  });

  it("rejects the same key with a different packet and a consumed run with a new key", async () => {
    const corpus = await createCorpus();
    const run = await startRun(corpus.id);
    const key = `submit-${randomUUID()}`;
    await submit(run.preparationRunId, validPacket(), key);

    const other = validPacket();
    other.legalRules[0].title = "Changed";
    await expectProblem(
      submit(run.preparationRunId, other, key),
      LEGAL_PORTFOLIO_ERROR_CODES.idempotencyConflict,
      409,
    );
    await expectProblem(
      submit(run.preparationRunId, validPacket()),
      LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
      409,
    );
  });

  it("an invalid packet records the failure, leaves the previous ACTIVE untouched and writes no children", async () => {
    const good = await submit(
      (await startRun((await createCorpus()).id)).preparationRunId,
      validPacket(),
    );
    const activeBefore = await prisma.legalPortfolioVersion.findFirstOrThrow({
      where: { lifecycleState: "ACTIVE" },
    });
    expect(activeBefore.id).toBe(good.portfolioVersionId);

    const corpus = await createCorpus();
    const run = await startRun(corpus.id);
    const bad = validPacket();
    bad.legalRules[0].sourceRefs.push({
      ...ref("art-1::cl-1"),
      locator: "art-99::cl-1",
    }); // fake reference
    bad.legalRules.push({ ...bad.legalRules[1] }); // duplicate rule id
    const result = await submit(run.preparationRunId, bad);

    expect(result.lifecycleState).toBe("INVALID");
    expect(result.validation.outcome).toBe("FAILED");
    expect(result.validation.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        LEGAL_PORTFOLIO_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE,
        LEGAL_PORTFOLIO_FAILURE_CODES.DUPLICATE_RULE_ID,
      ]),
    );
    expect(result.previousActivePortfolioVersionId).toBeNull();
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { resourceId: result.portfolioVersionId },
    });
    expect(JSON.stringify(audit.payload)).toContain(
      LEGAL_PORTFOLIO_FAILURE_CODES.UNRESOLVED_SOURCE_REFERENCE,
    );
    expect(
      (
        await prisma.legalPortfolioVersion.findFirstOrThrow({
          where: { lifecycleState: "ACTIVE" },
        })
      ).id,
    ).toBe(good.portfolioVersionId);
    expect(await activeCount()).toBe(1);
    expect(
      await prisma.legalPortfolioRule.count({
        where: { portfolioVersionId: result.portfolioVersionId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.legalPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe("FAILED");
    const record =
      await prisma.legalPortfolioActivationRecord.findUniqueOrThrow({
        where: { portfolioVersionId: result.portfolioVersionId },
      });
    expect(record.validationOutcome).toBe("FAILED");
    expect(
      (
        await prisma.outboxMessage.findMany({
          where: { aggregateId: result.portfolioVersionId },
        })
      ).map((e) => e.eventType),
    ).toEqual([LEGAL_PORTFOLIO_EVENT_TYPES.portfolioValidationFailed]);
  });

  it("rejects stale and mixed-version source claims against the pinned corpus", async () => {
    await createCorpus(true); // another corpus version where art-5::cl-1 differs
    const pinned = await createCorpus();
    const run = await startRun(pinned.id);
    const mixed = validPacket();
    mixed.legalRules[1].sourceRefs.push(ref("art-5::cl-1", "v2"));
    const result = await submit(run.preparationRunId, mixed);
    expect(result.validation.failures.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        LEGAL_PORTFOLIO_FAILURE_CODES.STALE_SOURCE_HASH,
        LEGAL_PORTFOLIO_FAILURE_CODES.MIXED_CORPUS_VERSION,
      ]),
    );
    expect(result.lifecycleState).toBe("INVALID");
  });

  it("fails closed when the pinned corpus has no valid retrieval index", async () => {
    const corpus = await createCorpus();
    await prisma.legalRetrievalIndex.updateMany({
      where: { legalCorpusVersionId: corpus.id },
      data: { status: "BUILDING", validatedAt: null },
    });
    const result = await submit(
      (await startRun(corpus.id)).preparationRunId,
      validPacket(),
    );
    expect(result.validation.failures.map((f) => f.code)).toContain(
      LEGAL_PORTFOLIO_FAILURE_CODES.RETRIEVAL_INDEX_NOT_VALID,
    );
  });

  it("supersedes the previous ACTIVE and keeps its rows immutable and readable (pins never retarget)", async () => {
    const first = await submit(
      (await startRun((await createCorpus()).id)).preparationRunId,
      validPacket(),
    );
    const firstRules = await prisma.legalPortfolioRule.count({
      where: { portfolioVersionId: first.portfolioVersionId },
    });
    const second = await submit(
      (await startRun((await createCorpus()).id)).preparationRunId,
      validPacket(),
    );

    expect(second.previousActivePortfolioVersionId).toBe(
      first.portfolioVersionId,
    );
    expect(await activeCount()).toBe(1);
    const old = await prisma.legalPortfolioVersion.findUniqueOrThrow({
      where: { id: first.portfolioVersionId },
    });
    expect(old.lifecycleState).toBe("SUPERSEDED");
    expect(old.supersededAt).not.toBeNull();
    expect(
      await prisma.legalPortfolioRule.count({
        where: { portfolioVersionId: first.portfolioVersionId },
      }),
    ).toBe(firstRules);
    if (await migrationGuardsPresent()) {
      await expect(
        prisma.legalPortfolioRule.updateMany({
          where: { portfolioVersionId: first.portfolioVersionId },
          data: { title: "tamper" },
        }),
      ).rejects.toThrow(/immutable/u);
    }
  });

  it("serializes concurrent submissions: exactly one ACTIVE and a consistent supersession chain", async () => {
    const runs = await Promise.all(
      [1, 2, 3].map(async () => startRun((await createCorpus()).id)),
    );
    const results = await Promise.all(
      runs.map((run) => submit(run.preparationRunId, validPacket())),
    );

    expect(await activeCount()).toBe(1);
    const active = await prisma.legalPortfolioVersion.findFirstOrThrow({
      where: { lifecycleState: "ACTIVE" },
    });
    expect(results.map((r) => r.portfolioVersionId)).toContain(active.id);
    const previous = results
      .map((r) => r.previousActivePortfolioVersionId)
      .filter(Boolean);
    // Each newer activation names a different predecessor: no two share one.
    expect(new Set(previous).size).toBe(previous.length);
    expect(results.every((r) => r.lifecycleState === "ACTIVE")).toBe(true);
  });

  it("returns one result for the same idempotency key submitted concurrently", async () => {
    const run = await startRun((await createCorpus()).id);
    const key = `submit-${randomUUID()}`;
    const [a, b] = await Promise.all([
      submit(run.preparationRunId, validPacket(), key),
      submit(run.preparationRunId, validPacket(), key),
    ]);
    expect(a.portfolioVersionId).toBe(b.portfolioVersionId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(
      await prisma.legalPortfolioVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(1);
  });

  it("rolls the whole activation back when any in-transaction write fails", async () => {
    const baseline = await submit(
      (await startRun((await createCorpus()).id)).preparationRunId,
      validPacket(),
    );
    const run = await startRun((await createCorpus()).id);
    const spy = jest
      .spyOn(outbox, "enqueue")
      .mockRejectedValueOnce(new Error("outbox unavailable"));

    await expect(submit(run.preparationRunId, validPacket())).rejects.toThrow(
      /outbox unavailable/u,
    );
    spy.mockRestore();

    expect(
      (
        await prisma.legalPortfolioVersion.findFirstOrThrow({
          where: { lifecycleState: "ACTIVE" },
        })
      ).id,
    ).toBe(baseline.portfolioVersionId);
    expect(
      await prisma.legalPortfolioVersion.count({
        where: { preparationRunId: run.preparationRunId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.legalPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe("QUEUED");
    // the same request is safely retryable afterwards
    const retried = await submit(run.preparationRunId, validPacket());
    expect(retried.lifecycleState).toBe("ACTIVE");
  });

  it("validates the request shape at the trust boundary", async () => {
    const run = await startRun((await createCorpus()).id);
    const withAuthority = {
      ...validPacket(),
      portfolioVersionId: randomUUID(),
    };
    await expectProblem(
      submit(run.preparationRunId, withAuthority),
      LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
      400,
    );
    await expectProblem(
      submit(randomUUID(), validPacket()),
      LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
      404,
    );
  });

  it("claims a run (QUEUED -> RUNNING) and serves only its pinned corpus", async () => {
    const corpus = await createCorpus();
    await createCorpus(true); // an unrelated corpus must never appear in the bundle
    const run = await startRun(corpus.id);

    const bundle = await service.claimPreparation({
      body: { preparationRunId: run.preparationRunId },
      correlationId: randomUUID(),
    });
    expect(legalPreparationCorpusBundleSchema.safeParse(bundle).success).toBe(
      true,
    );
    expect(bundle.executionState).toBe("RUNNING");
    expect(bundle.legalCorpusVersionId).toBe(corpus.id);
    expect(bundle.documents).toHaveLength(1);
    expect(bundle.documents[0].chunks.map((c) => c.locator)).toEqual(
      [...FIXTURE_LOCATORS].sort(),
    );
    expect(
      (
        await prisma.legalPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).startedAt,
    ).not.toBeNull();

    // claiming again while RUNNING is idempotent and keeps the same state
    const again = await service.claimPreparation({
      body: { preparationRunId: run.preparationRunId },
      correlationId: randomUUID(),
    });
    expect(again.executionState).toBe("RUNNING");

    await submit(run.preparationRunId, validPacket());
    await expectProblem(
      service.claimPreparation({
        body: { preparationRunId: run.preparationRunId },
        correlationId: randomUUID(),
      }),
      LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
      409,
    );
    await expectProblem(
      service.claimPreparation({
        body: { preparationRunId: randomUUID() },
        correlationId: randomUUID(),
      }),
      LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
      404,
    );
  });

  it("validates a packet as a dry-run without persisting anything", async () => {
    const run = await startRun((await createCorpus()).id);
    const before = await prisma.legalPortfolioVersion.count();
    const bad = validPacket();
    bad.engineeringRules[0].legalRuleIds = ["LR-MISSING"];

    const failed = await service.validate({
      body: { preparationRunId: run.preparationRunId, packet: bad },
      correlationId: randomUUID(),
    });
    expect(failed.outcome).toBe("FAILED");
    expect(failed.failures.map((f) => f.code)).toContain(
      LEGAL_PORTFOLIO_FAILURE_CODES.ORPHAN_ENGINEERING_RULE,
    );
    const passed = await service.validate({
      body: { preparationRunId: run.preparationRunId, packet: validPacket() },
      correlationId: randomUUID(),
    });
    expect(passed).toEqual({ outcome: "PASSED", failures: [] });

    expect(await prisma.legalPortfolioVersion.count()).toBe(before);
    expect(
      (
        await prisma.legalPreparationRun.findUniqueOrThrow({
          where: { id: run.preparationRunId },
        })
      ).executionState,
    ).toBe("QUEUED");
  });

  it("records an execution failure once and refuses to fail a finished run", async () => {
    const run = await startRun((await createCorpus()).id);
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
        await prisma.legalPreparationRun.findUniqueOrThrow({
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
      LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
      409,
    );

    const done = await startRun((await createCorpus()).id);
    await submit(done.preparationRunId, validPacket());
    await expectProblem(
      service.failPreparation({
        body: {
          preparationRunId: done.preparationRunId,
          reason: "RUNTIME_ERROR",
        },
        correlationId: randomUUID(),
      }),
      LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
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
      LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
      400,
    );
  });

  it("starts a preparation run idempotently and enqueues one command", async () => {
    const corpus = await createCorpus();
    const other = await createCorpus();
    const key = `start-${randomUUID()}`;
    const body = { legalCorpusVersionId: corpus.id, idempotencyKey: key };
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
          aggregateId: corpus.id,
          eventType: LEGAL_PORTFOLIO_EVENT_TYPES.preparationRequested,
        },
      }),
    ).toBe(1);
    await expectProblem(
      service.startPreparation({
        body: { legalCorpusVersionId: other.id, idempotencyKey: key },
        requestedBy: "w",
        correlationId: randomUUID(),
      }),
      LEGAL_PORTFOLIO_ERROR_CODES.idempotencyConflict,
      409,
    );
    await expectProblem(
      service.startPreparation({
        body: {
          legalCorpusVersionId: randomUUID(),
          idempotencyKey: `start-${randomUUID()}`,
        },
        requestedBy: "w",
        correlationId: randomUUID(),
      }),
      "CORPUS_VERSION_NOT_FOUND",
      404,
    );
  });
});
