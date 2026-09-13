import { describe, expect, it, jest } from "@jest/globals";
import { CORPUS_VERSION_READINESS_STATES } from "@lcsp/contracts/legal-rule-catalog";

import { AdminCorpusVersionsService } from "./admin-corpus-versions.service.js";

describe("AdminCorpusVersionsService", () => {
  it("does not infer publication readiness from persisted documents or change sets", async () => {
    const findUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      id: "corpus-1",
      version: "v2026.09.02-draft",
      status: "DRAFT",
      sourceManifest: {
        changeSet: {
          addedDocumentIds: ["document-1"],
        },
      },
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
      approvedAt: null,
      documents: [{ chunks: [{ id: "chunk-1" }] }],
      retrievalIndexes: [
        {
          status: "VALID",
          validatedAt: new Date("2026-09-02T01:00:00.000Z"),
          validationManifestRef: "retrieval-validation:index-1",
        },
      ],
    });
    const service = new AdminCorpusVersionsService(
      { legalCorpusVersion: { findUnique } } as never,
      {} as never,
    );

    const detail = await service.detail("corpus-1");

    expect(detail.readiness).toBe(CORPUS_VERSION_READINESS_STATES.unavailable);
    expect(
      detail.readinessItems.every(
        (item) => item.state === CORPUS_VERSION_READINESS_STATES.unavailable,
      ),
    ).toBe(true);
    expect(
      detail.snapshot.every(
        (row) => row.validation === CORPUS_VERSION_READINESS_STATES.unavailable,
      ),
    ).toBe(true);
    expect(detail.actions.canPublish).toBe(false);
    expect(detail.actions.canDiscard).toBe(true);
  });

  it("enables publish only for a canonically ready draft and keeps refs server-side", async () => {
    const version = {
      id: "corpus-ready",
      version: "v-ready",
      status: "DRAFT",
      sourceManifest: {
        validation: {
          SOURCE_PARSING: "PASSED",
          RETRIEVAL_VALIDATION: "PASSED",
          INTEGRITY_MANIFEST: "PASSED",
          RULE_SNAPSHOT: "PASSED",
          DIFF_REVIEW: "PASSED",
          integrityManifestRef: "integrity:manifest-1",
        },
      },
      integrityManifestRef: null,
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
      approvedAt: null,
      documents: [{ chunks: [{ id: "chunk-1" }] }],
      retrievalIndexes: [
        {
          status: "VALID",
          validatedAt: new Date(),
          validationManifestRef: "retrieval:index-1",
        },
      ],
    };
    const prisma = {
      legalCorpusVersion: {
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(version),
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      },
    };
    const activateValidatedCorpusVersion = jest
      .fn<(input: unknown) => Promise<unknown>>()
      .mockResolvedValue({});
    const auditWriter = {
      write: jest
        .fn<(input: unknown) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const service = new AdminCorpusVersionsService(
      prisma as never,
      auditWriter as never,
      { activateValidatedCorpusVersion } as never,
    );

    const detail = await service.detail("corpus-ready");
    expect(detail.actions.canPublish).toBe(true);
    await service.publish({
      versionId: "corpus-ready",
      actorId: "admin-1",
      idempotencyKey: "publish-1",
      correlationId: "corr-1",
    });
    expect(activateValidatedCorpusVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        integrityManifestRef: "integrity:manifest-1",
        retrievalValidationRef: "retrieval:index-1",
        idempotencyKey: "publish-1",
      }),
    );
  });

  it("treats explicitly non-applicable preparation checks as ready without fabricating PASSED", async () => {
    const findUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      id: "corpus-prepared",
      version: "v-prepared",
      status: "DRAFT",
      sourceManifest: {
        validation: {
          SOURCE_PARSING: "PASSED",
          RETRIEVAL_VALIDATION: "PASSED",
          INTEGRITY_MANIFEST: "PASSED",
          RULE_SNAPSHOT: "UNAVAILABLE",
          DIFF_REVIEW: "UNAVAILABLE",
          applicable: { RULE_SNAPSHOT: false, DIFF_REVIEW: false },
          integrityManifestRef: "integrity:manifest-prepared",
        },
      },
      integrityManifestRef: "integrity:manifest-prepared",
      createdAt: new Date(),
      approvedAt: null,
      documents: [{ chunks: [{ id: "chunk-1" }] }],
      retrievalIndexes: [
        {
          status: "VALID",
          validatedAt: new Date(),
          validationManifestRef: "retrieval:index-prepared",
        },
      ],
      preparation: { requestedBy: "admin-1" },
    });
    const service = new AdminCorpusVersionsService(
      {
        legalCorpusVersion: {
          findUnique,
          findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
        },
      } as never,
      {} as never,
    );

    const detail = await service.detail("corpus-prepared");

    expect(detail.readiness).toBe(CORPUS_VERSION_READINESS_STATES.ready);
    expect(detail.actions.canPublish).toBe(true);
    expect(
      detail.readinessItems.find((item) => item.check === "RULE_SNAPSHOT")
        ?.state,
    ).toBe(CORPUS_VERSION_READINESS_STATES.unavailable);
  });

  it("blocks publish when canonical readiness is incomplete", async () => {
    const findUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      id: "corpus-pending",
      version: "v-pending",
      status: "DRAFT",
      sourceManifest: { validation: { SOURCE_PARSING: "PASSED" } },
      integrityManifestRef: "integrity:manifest-1",
      createdAt: new Date(),
      approvedAt: null,
      documents: [{ chunks: [{ id: "chunk-1" }] }],
      retrievalIndexes: [
        {
          status: "VALID",
          validatedAt: new Date(),
          validationManifestRef: "retrieval:index-1",
        },
      ],
    });
    const activateValidatedCorpusVersion =
      jest.fn<(input: unknown) => Promise<unknown>>();
    const service = new AdminCorpusVersionsService(
      {
        legalCorpusVersion: {
          findUnique,
          findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
        },
      } as never,
      {
        write: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      } as never,
      { activateValidatedCorpusVersion } as never,
    );
    await expect(
      service.publish({
        versionId: "corpus-pending",
        actorId: "admin-1",
        idempotencyKey: "publish-2",
        correlationId: "corr-2",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(activateValidatedCorpusVersion).not.toHaveBeenCalled();
  });

  it("creates one canonical draft and enqueues preparation idempotently", async () => {
    const tx = {
      legalCorpusVersion: {
        create: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ id: "target-1" }),
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      },
      corpusPreparation: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
        create: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "prep-1",
          targetCorpusId: "target-1",
          status: "REQUESTED",
        }),
      },
    };
    const prisma = {
      corpusPreparation: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      },
      legalCorpusVersion: {
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "base-1",
          version: "v-base",
          status: "APPROVED",
        }),
      },
      $transaction: jest.fn(
        async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      ),
    };
    const enqueue = jest
      .fn<(event: unknown, client: unknown) => Promise<string>>()
      .mockResolvedValue("outbox-1");
    const service = new AdminCorpusVersionsService(
      prisma as never,
      {
        writeInTx: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      } as never,
      undefined,
      { enqueue } as never,
    );
    const result = await service.prepare({
      actorId: "admin-1",
      idempotencyKey: "prep-key",
      correlationId: "corr-1",
    });
    expect(result).toMatchObject({
      corpusVersionId: "target-1",
      status: "REQUESTED",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "command.legal-corpus.recovery.requested.v1",
      }),
      tx,
    );
  });

  it("replays a publish by idempotency key after activation", async () => {
    const version = {
      id: "corpus-published",
      version: "v-published",
      status: "APPROVED",
      sourceManifest: { validation: {} },
      integrityManifestRef: "integrity:manifest-1",
      createdAt: new Date(),
      approvedAt: new Date(),
      documents: [{ chunks: [{ id: "chunk-1" }] }],
      retrievalIndexes: [],
      preparation: null,
    };
    const prisma = {
      corpusApprovalRecord: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          legalCorpusVersionId: "corpus-published",
        }),
      },
      legalCorpusVersion: {
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(version),
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      },
    };
    const service = new AdminCorpusVersionsService(
      prisma as never,
      {} as never,
      { activateValidatedCorpusVersion: jest.fn() } as never,
    );

    const result = await service.publish({
      versionId: "corpus-published",
      actorId: "admin-1",
      idempotencyKey: "publish-replay",
      correlationId: "corr-replay",
    });

    expect(result.status).toBe("APPROVED");
  });

  it("rejects a publish key replayed against another version", async () => {
    const prisma = {
      corpusApprovalRecord: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          legalCorpusVersionId: "other-version",
        }),
      },
      legalCorpusVersion: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "corpus-2",
          status: "DRAFT",
          retrievalIndexes: [],
        }),
      },
    };
    const service = new AdminCorpusVersionsService(
      prisma as never,
      {} as never,
      { activateValidatedCorpusVersion: jest.fn() } as never,
    );

    await expect(
      service.publish({
        versionId: "corpus-2",
        actorId: "admin-1",
        idempotencyKey: "publish-replay",
        correlationId: "corr-replay-conflict",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("replays a discard receipt without requiring DRAFT state", async () => {
    const version = {
      id: "corpus-discarded",
      version: "v-discarded",
      status: "REJECTED",
      sourceManifest: {},
      createdAt: new Date(),
      approvedAt: null,
      documents: [],
      retrievalIndexes: [],
      preparation: null,
    };
    const prisma = {
      corpusDiscardReceipt: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          corpusVersionId: "corpus-discarded",
        }),
      },
      legalCorpusVersion: {
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(version),
        findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
      },
    };
    const service = new AdminCorpusVersionsService(
      prisma as never,
      {} as never,
    );

    const result = await service.discardDraft({
      versionId: "corpus-discarded",
      actorId: "admin-1",
      idempotencyKey: "discard-replay",
      correlationId: "corr-discard-replay",
    });

    expect(result.status).toBe("REJECTED");
  });

  it("does not allow a terminal preparation callback to change state", async () => {
    const preparation = {
      id: "prep-1",
      targetCorpusId: "corpus-1",
      status: "COMPLETED",
    };
    const tx = {
      corpusPreparation: {
        updateMany: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ count: 0 }),
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(preparation),
      },
    };
    const prisma = {
      corpusPreparation: {
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(preparation),
      },
      $transaction: jest.fn(
        async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
      ),
    };
    const service = new AdminCorpusVersionsService(
      prisma as never,
      {} as never,
    );

    await expect(
      service.completePreparation({
        preparationId: "prep-1",
        corpusVersionId: "corpus-1",
        status: "COMPLETED",
        correlationId: "corr-terminal-replay",
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(
      service.completePreparation({
        preparationId: "prep-1",
        corpusVersionId: "corpus-1",
        status: "FAILED",
        correlationId: "corr-terminal-conflict",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
