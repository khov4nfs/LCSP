import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import {
  LegalRetrievalIndexStatus,
  LegalSourceDocumentIngestionState,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";

import { LegalSourceService } from "./legal-source.service.js";
import { LegalSourceDocumentService } from "./legal-source-document.service.js";

const rawUrl = process.env.DATABASE_URL ?? "";
const url = rawUrl ? new URL(rawUrl) : null;
const dedicated =
  url?.hostname === "127.0.0.1" &&
  url.port === "55446" &&
  url.pathname === "/lcsp_legal_source_race_test";
const database = dedicated ? describe : describe.skip;

database("Legal Source lifecycle PostgreSQL race", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(rawUrl) });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("does not activate from a pre-lock snapshot after a locked document deletion", async () => {
    // Why: A Serializable snapshot can be fixed by the advisory-lock query before the version row lock is acquired.
    // How: Hold the version row, let activation take its first transaction snapshot, then delete the document and release the row.
    // Invariant: No ACTIVE version or activation record may survive with an empty corpus.
    const source = await prisma.legalSource.create({
      data: { slug: `race-${randomUUID()}`, name: "Race source" },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `race-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalSourceVersionId: version.id,
        documentId: `doc-${randomUUID()}`,
        title: "Race document",
        sourceUrl: "https://example.com/race",
        sourceSha256: "sha256:source",
        sourceEffectStatus: "CURRENT",
      },
    });
    await prisma.legalDocumentChunk.create({
      data: {
        id: randomUUID(),
        legalSourceVersionId: version.id,
        legalSourceDocumentId: document.id,
        documentId: document.documentId,
        locator: "article-1",
        content: "legal text",
        contentSha256: "sha256:content",
        hierarchy: {},
        legalStatus: "CURRENT",
      },
    });
    await prisma.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId: version.id,
        version: `index-${randomUUID()}`,
        status: LegalRetrievalIndexStatus.VALID,
        configHash: "sha256:config",
        contentHash: "sha256:content",
        validationManifestRef: "manifest:index-1",
        validatedAt: new Date(),
      },
    });

    let releaseRow: (() => void) | undefined;
    const rowRelease = new Promise<void>((resolve) => {
      releaseRow = resolve;
    });
    let signalRowLocked: (() => void) | undefined;
    const rowLocked = new Promise<void>((resolve) => {
      signalRowLocked = resolve;
    });
    const deleting = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "LegalSourceVersion" WHERE id = ${version.id} FOR UPDATE`,
      );
      signalRowLocked?.();
      await rowRelease;
      await tx.legalSourceDocument.delete({ where: { id: document.id } });
    });
    await rowLocked;

    let signalSnapshotTaken: (() => void) | undefined;
    const snapshotTaken = new Promise<void>((resolve) => {
      signalSnapshotTaken = resolve;
    });
    const service = new LegalSourceService(
      {
        legalSourceActivationRecord: prisma.legalSourceActivationRecord,
        legalSourceVersion: prisma.legalSourceVersion,
        $transaction: (
          work: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options: {
            isolationLevel?: Prisma.TransactionIsolationLevel;
            maxWait?: number;
            timeout?: number;
          },
        ) =>
          prisma.$transaction(async (tx) => {
            let firstQuery = true;
            const wrappedTx = {
              $queryRaw: async (sql: Prisma.Sql) => {
                const rows = await tx.$queryRaw(sql);
                if (firstQuery) {
                  firstQuery = false;
                  signalSnapshotTaken?.();
                }
                return rows;
              },
              legalSourceVersion: tx.legalSourceVersion,
              legalSourceActivationRecord: tx.legalSourceActivationRecord,
            } as unknown as Prisma.TransactionClient;
            return work(wrappedTx);
          }, options),
      } as never,
      {
        enqueue: jest.fn<() => Promise<string>>().mockResolvedValue("outbox-1"),
      } as never,
      {
        writeInTx: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      } as never,
    );
    const activating = service.activateValidatedLegalSourceVersion({
      legalSourceVersionId: version.id,
      integrityManifestRef: "manifest:integrity-1",
      retrievalValidationRef: "manifest:index-1",
      idempotencyKey: randomUUID(),
      scopeDescription: "race test",
      comments: null,
      correlationId: randomUUID(),
    });
    await snapshotTaken;
    releaseRow?.();
    await deleting;
    await expect(activating).rejects.toMatchObject({
      response: { problem: { status: 409 } },
    });
    const persisted = await prisma.legalSourceVersion.findUniqueOrThrow({
      where: { id: version.id },
    });
    expect(persisted.status).toBe("DRAFT");
    expect(
      await prisma.legalSourceActivationRecord.count({
        where: { legalSourceVersionId: version.id },
      }),
    ).toBe(0);
  });

  it("does not begin a stale ingestion attempt after a retry commits under the version lock", async () => {
    // Why: A worker can read attempt 1 while a retry owns the version lock and advances it to attempt 2.
    // How: Force the first read before the retry commits, then let beginIngestion acquire the lock and reread.
    // Invariant: Attempt 1 cannot mark attempt 2 PROCESSING or receive its source bytes.
    const source = await prisma.legalSource.create({
      data: {
        slug: `ingest-race-${randomUUID()}`,
        name: "Ingestion race source",
      },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `ingest-race-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const blob = await prisma.legalSourceDocumentBlob.create({
      data: {
        sha256: `sha256:${randomUUID()}`,
        byteLength: 10,
        bytes: Buffer.from("legal text"),
      },
    });
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalSourceVersionId: version.id,
        documentId: `ingest-doc-${randomUUID()}`,
        title: "Ingestion race document",
        sourceUrl: "https://example.com/ingest-race",
        sourceSha256: blob.sha256,
        sourceEffectStatus: "CURRENT",
        blobSha256: blob.sha256,
        mediaType: "text/plain",
        ingestionAttempt: 1,
        ingestionState: LegalSourceDocumentIngestionState.PENDING,
      },
    });

    let releaseRow: (() => void) | undefined;
    const rowRelease = new Promise<void>((resolve) => {
      releaseRow = resolve;
    });
    let signalRowLocked: (() => void) | undefined;
    const rowLocked = new Promise<void>((resolve) => {
      signalRowLocked = resolve;
    });
    const retrying = prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "LegalSourceVersion" WHERE id = ${version.id} FOR UPDATE`,
      );
      signalRowLocked?.();
      await rowRelease;
      await tx.legalSourceDocument.update({
        where: { id: document.id },
        data: { ingestionAttempt: 2 },
      });
    });
    await rowLocked;

    let signalInitialRead: (() => void) | undefined;
    const initialRead = new Promise<void>((resolve) => {
      signalInitialRead = resolve;
    });
    const service = new LegalSourceDocumentService(
      {
        $transaction: (
          work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          prisma.$transaction(async (tx) => {
            let firstRead = true;
            const wrappedTx = {
              $queryRaw: (sql: Prisma.Sql) => tx.$queryRaw(sql),
              legalSourceDocument: {
                findUnique: async (
                  args: Parameters<typeof tx.legalSourceDocument.findUnique>[0],
                ) => {
                  const found = await tx.legalSourceDocument.findUnique(args);
                  if (firstRead) {
                    firstRead = false;
                    signalInitialRead?.();
                  }
                  return found;
                },
              },
            } as unknown as Prisma.TransactionClient;
            return work(wrappedTx);
          }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const beginning = service.beginIngestion({
      documentRowId: document.id,
      attempt: 1,
      correlationId: randomUUID(),
    });
    await initialRead;
    releaseRow?.();
    await retrying;
    await expect(beginning).rejects.toMatchObject({
      response: { problem: { status: 409 } },
    });
    const persisted = await prisma.legalSourceDocument.findUniqueOrThrow({
      where: { id: document.id },
    });
    expect(persisted.ingestionAttempt).toBe(2);
    expect(persisted.ingestionState).toBe(
      LegalSourceDocumentIngestionState.PENDING,
    );
  });

  it("activates a stable validated corpus under the same database lock path", async () => {
    // Why: The race guard must still permit a valid activation after switching transaction isolation.
    // How: Persist one draft document, chunk and validated index, then execute the real transaction path.
    // Invariant: Normal activation commits exactly one ACTIVE version and one activation record.
    const source = await prisma.legalSource.create({
      data: { slug: `stable-${randomUUID()}`, name: "Stable source" },
    });
    const version = await prisma.legalSourceVersion.create({
      data: {
        legalSourceId: source.id,
        version: `stable-${randomUUID()}`,
        sourceManifest: {},
      },
    });
    const document = await prisma.legalSourceDocument.create({
      data: {
        legalSourceVersionId: version.id,
        documentId: `stable-doc-${randomUUID()}`,
        title: "Stable document",
        sourceUrl: "https://example.com/stable",
        sourceSha256: "sha256:source",
        sourceEffectStatus: "CURRENT",
      },
    });
    await prisma.legalDocumentChunk.create({
      data: {
        id: randomUUID(),
        legalSourceVersionId: version.id,
        legalSourceDocumentId: document.id,
        documentId: document.documentId,
        locator: "article-1",
        content: "legal text",
        contentSha256: "sha256:content",
        hierarchy: {},
        legalStatus: "CURRENT",
      },
    });
    await prisma.legalRetrievalIndex.create({
      data: {
        legalSourceVersionId: version.id,
        version: `stable-index-${randomUUID()}`,
        status: LegalRetrievalIndexStatus.VALID,
        configHash: "sha256:config",
        contentHash: "sha256:content",
        validationManifestRef: "manifest:stable-index",
        validatedAt: new Date(),
      },
    });
    const service = new LegalSourceService(
      prisma as never,
      {
        enqueue: jest.fn<() => Promise<string>>().mockResolvedValue("outbox-1"),
      } as never,
      {
        writeInTx: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      } as never,
    );
    const activated = await service.activateValidatedLegalSourceVersion({
      legalSourceVersionId: version.id,
      integrityManifestRef: "manifest:integrity-1",
      retrievalValidationRef: "manifest:stable-index",
      idempotencyKey: randomUUID(),
      scopeDescription: "stable test",
      comments: null,
      correlationId: randomUUID(),
    });
    expect(activated.status).toBe("ACTIVE");
    expect(
      (
        await prisma.legalSourceVersion.findUniqueOrThrow({
          where: { id: version.id },
        })
      ).status,
    ).toBe("ACTIVE");
    expect(
      await prisma.legalSourceActivationRecord.count({
        where: { legalSourceVersionId: version.id },
      }),
    ).toBe(1);
  });
});
