import { describe, expect, it, jest } from "@jest/globals";

import { LegalSourceDocumentService } from "./legal-source-document.service.js";
import { LegalSourceService } from "./legal-source.service.js";

describe("RED: Legal Source lifecycle lock boundaries", () => {
  it("does not activate a draft after its validated document was removed", async () => {
    // Why: A draft can change between validation and the activation transaction.
    // How: Remove its document immediately before the mocked transaction starts.
    // Invariant: ACTIVE must describe the corpus and index rechecked under the activation lock.
    let active = false;
    let documents = [{ chunks: [{ id: "chunk-1" }] }];
    const prisma = {
      legalSourceActivationRecord: {
        findUnique: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      },
      legalSourceVersion: {
        findUnique: jest.fn<() => Promise<object>>().mockImplementation(() =>
          Promise.resolve({
            id: "version-1",
            version: "v1",
            status: "DRAFT",
            documents,
            retrievalIndexes: [
              {
                validationManifestRef: "manifest:index-1",
                status: "VALID",
                validatedAt: new Date(),
              },
            ],
          }),
        ),
      },
      $transaction: async (work: (client: object) => Promise<unknown>) => {
        documents = [];
        return work({
          $queryRaw: jest
            .fn<() => Promise<Array<{ acquired: boolean }>>>()
            .mockResolvedValue([{ acquired: true }]),
          legalSourceVersion: {
            findUnique: jest
              .fn<() => Promise<object>>()
              .mockImplementation(() =>
                Promise.resolve({
                  id: "version-1",
                  status: "DRAFT",
                  documents,
                  retrievalIndexes: [
                    {
                      validationManifestRef: "manifest:index-1",
                      status: "VALID",
                      validatedAt: new Date(),
                    },
                  ],
                }),
              ),
            findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
            updateMany: jest
              .fn<() => Promise<{ count: number }>>()
              .mockImplementation(() => {
                active = true;
                return Promise.resolve({ count: 1 });
              }),
          },
          legalSourceActivationRecord: {
            create: jest
              .fn<() => Promise<{ id: string }>>()
              .mockResolvedValue({ id: "activation-1" }),
            update: jest.fn<() => Promise<object>>().mockResolvedValue({}),
          },
        });
      },
    };
    const service = new LegalSourceService(
      prisma as never,
      {
        enqueue: jest.fn<() => Promise<string>>().mockResolvedValue("outbox-1"),
      } as never,
      {
        writeInTx: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      } as never,
    );

    await expect(
      service.activateValidatedLegalSourceVersion({
        legalSourceVersionId: "version-1",
        integrityManifestRef: "integrity:manifest-1",
        retrievalValidationRef: "manifest:index-1",
        idempotencyKey: "activation-1",
        scopeDescription: "test",
        comments: null,
        correlationId: "red-test",
      }),
    ).rejects.toMatchObject({ response: { problem: { status: 409 } } });
    expect(active).toBe(false);
  });

  it("does not mark a newer ingestion attempt PROCESSING using a stale pre-lock row", async () => {
    // Why: A retry may increment ingestionAttempt while the worker waits for the version lock.
    // How: Return attempt 1 before locking and advance the persisted row to attempt 2 at lock time.
    // Invariant: A stale worker cannot claim or return the original for the newer attempt.
    let persistedAttempt = 1;
    const update = jest.fn<() => Promise<object>>().mockResolvedValue({});
    const document = {
      id: "document-1",
      legalSourceVersionId: "version-1",
      mediaType: "text/plain",
      ingestionAttempt: 1,
      ingestionState: "PENDING",
      structureProfile: "AUTO",
      blob: { bytes: Buffer.from("legal text"), sha256: "sha256:test" },
    };
    const tx = {
      legalSourceDocument: {
        findUnique: jest.fn<() => Promise<object>>().mockImplementation(() =>
          Promise.resolve({
            ...document,
            ingestionAttempt: persistedAttempt,
          }),
        ),
        update,
      },
      $queryRaw: jest
        .fn<
          () => Promise<Array<{ id: string; status: string; version: string }>>
        >()
        .mockImplementation(() => {
          persistedAttempt = 2;
          return Promise.resolve([
            { id: "version-1", status: "DRAFT", version: "v1" },
          ]);
        }),
    };
    const service = new LegalSourceDocumentService(
      {
        $transaction: (work: (client: typeof tx) => Promise<unknown>) =>
          work(tx),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.beginIngestion({
        documentRowId: "document-1",
        attempt: 1,
        correlationId: "red-test",
      }),
    ).rejects.toMatchObject({ response: { problem: { status: 409 } } });
    expect(update).not.toHaveBeenCalled();
  });
});
