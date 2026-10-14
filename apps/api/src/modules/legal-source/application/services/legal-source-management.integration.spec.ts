import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
  LEGAL_SOURCE_DOCUMENT_INGESTION_STATES as States,
  LEGAL_SOURCE_IMPORT_REJECTION_REASONS as Reasons,
  LEGAL_SOURCE_LIFECYCLE_STATUSES as Lifecycle,
  LEGAL_SOURCE_MANAGEMENT_ERROR_CODES as Errors,
  LEGAL_SOURCE_STRUCTURE_PROFILES as Profiles,
  LEGAL_SOURCE_VERSION_BLOCKERS as Blockers,
  type LegalSourceIngestionResult,
} from "@lcsp/contracts/legal-source";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { LegalSourceDocumentService } from "./legal-source-document.service.js";
import { LegalSourceManagementService } from "./legal-source-management.service.js";
import { sha256Ref } from "./legal-source-structure.js";
import { LegalSourceService } from "./legal-source.service.js";
import {
  ImportRejectedError,
  type FetchedDocument,
  type SafeUrlFetcherService,
} from "./safe-url-fetcher.service.js";

// Activation supersedes every other ACTIVE version, so this proof owns a whole database.
// Run: DATABASE_URL=postgresql://…@127.0.0.1:55445/lcsp_legal_source_mgmt_test?schema=public
const url = new URL(process.env.DATABASE_URL ?? "postgresql://unused/unused");
const isolated =
  url.hostname === "127.0.0.1" &&
  url.port === "55445" &&
  url.pathname === "/lcsp_legal_source_mgmt_test";
const database = isolated ? describe : describe.skip;

const ADMIN = "00000000-0000-4000-8000-000000000001";
const text = (value: string) => Buffer.from(value, "utf8");

function readyResult(
  attempt: number,
  chunks: Array<{ locator: string; content: string }>,
): LegalSourceIngestionResult {
  return {
    outcome: "READY",
    attempt,
    extraction: {
      tool: "test-extractor",
      toolVersion: "1",
      structureProfile: Profiles.PARAGRAPHS,
      pageCount: null,
      textSha256: sha256Ref("text"),
      characterCount: 10,
    },
    chunks: chunks.map((chunk, index) => ({
      locator: chunk.locator,
      content: chunk.content,
      contentSha256: sha256Ref(chunk.content),
      hierarchy: { ordinal: index },
      pageStart: null,
      pageEnd: null,
    })),
  };
}

database("Legal Source management on PostgreSQL", () => {
  let prisma: PrismaClient;
  let management: LegalSourceManagementService;
  let documents: LegalSourceDocumentService;
  let fetcher: { fetch: jest.Mock<(url: string) => Promise<FetchedDocument>> };
  let counter = 0;

  const correlation = () => `corr-${randomUUID()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(url.toString()) });
    await prisma.$connect();
    const service = prisma as unknown as PrismaService;
    const outbox = new OutboxRepository(service);
    const audit = new AuditWriterService(service);
    fetcher = { fetch: jest.fn() };
    documents = new LegalSourceDocumentService(
      service,
      outbox,
      audit,
      fetcher as unknown as SafeUrlFetcherService,
    );
    management = new LegalSourceManagementService(
      service,
      audit,
      documents,
      new LegalSourceService(service, outbox, audit),
    );
  });

  beforeEach(async () => {
    fetcher.fetch.mockReset();
    // Drafts and unreferenced versions are disposable here; ACTIVE ones are superseded by the test that
    // activates, never deleted.
    await prisma.outboxMessage.deleteMany({
      where: { eventType: LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function newSource(
    name = `Source ${(counter += 1)} ${randomUUID().slice(0, 6)}`,
  ) {
    return management.createSource({
      actorId: ADMIN,
      correlationId: correlation(),
      request: { name },
    });
  }

  async function newDraft(sourceId: string, basedOnVersionId?: string) {
    return management.createVersion({
      sourceId,
      actorId: ADMIN,
      correlationId: correlation(),
      request: { basedOnVersionId },
    });
  }

  async function upload(
    versionId: string,
    fileName: string,
    body: string,
    declaredType: string | null = "text/plain",
  ) {
    return documents.addUpload({
      versionId,
      actorId: ADMIN,
      correlationId: correlation(),
      bytes: text(body),
      declaredType,
      metadata: { fileName, structureProfile: Profiles.AUTO },
    });
  }

  async function ingest(
    documentRowId: string,
    attempt: number,
    locators: string[],
  ) {
    return documents.recordIngestionResult({
      documentRowId,
      result: readyResult(
        attempt,
        locators.map((locator) => ({ locator, content: `text of ${locator}` })),
      ),
      correlationId: correlation(),
    });
  }

  async function readyDraft(
    sourceId: string,
    name: string,
    locators = ["p-1", "p-2"],
  ) {
    const draft = await newDraft(sourceId);
    const document = await upload(
      draft.id,
      `${name}.txt`,
      `Document ${name} ${randomUUID()}`,
    );
    await ingest(document.id, 1, locators);
    return { versionId: draft.id, documentRowId: document.id };
  }

  describe("sources and versions", () => {
    it("creates a source with a slug from its name and refuses an explicit duplicate slug", async () => {
      const first = await management.createSource({
        actorId: ADMIN,
        correlationId: correlation(),
        request: {
          name: "Quy định mẫu",
          slug: `mau-${randomUUID().slice(0, 6)}`,
        },
      });
      expect(first.slug).toMatch(/^mau-/);
      expect(first.versions).toEqual([]);
      expect(first.canCreateVersion).toBe(true);

      await expect(
        management.createSource({
          actorId: ADMIN,
          correlationId: correlation(),
          request: { name: "Another", slug: first.slug },
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.slugTaken } },
      });

      const derivedA = await newSource("Same Name Twice");
      const derivedB = await newSource("Same Name Twice");
      expect(derivedA.slug).not.toBe(derivedB.slug);
    });

    it("keeps one open draft per source and numbers versions by source", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      expect(draft.status).toBe(Lifecycle.draft);
      expect(draft.version).toBe(`${source.slug}.v1`);
      expect(draft.canAddDocuments).toBe(true);
      expect(draft.blockers).toEqual([Blockers.NO_DOCUMENTS]);

      const again = await newDraft(source.id);
      expect(again.id).toBe(draft.id);
      const detail = await management.getSource(source.id, correlation());
      expect(detail.versions).toHaveLength(1);
      expect(detail.canCreateVersion).toBe(false);
      expect(detail.openDraftVersionId).toBe(draft.id);
    });

    it("assigns a parent source to a version inserted without one (older callers)", async () => {
      const legacy = await prisma.legalSourceVersion.create({
        data: {
          version: `legacy-${randomUUID().slice(0, 8)}`,
          sourceManifest: {},
        },
        include: { legalSource: true },
      });
      expect(legacy.legalSourceId).not.toBeNull();
      expect(legacy.legalSource?.name).toBe(legacy.version);
    });
  });

  describe("adding documents", () => {
    it("stores the original once, queues ingestion and exposes the pending state", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);

      const document = await upload(
        draft.id,
        "Luật mẫu 01.txt",
        "Điều 1. Phạm vi\nNội dung",
      );

      expect(document.ingestionState).toBe(States.PENDING);
      expect(document.attempt).toBe(1);
      expect(document.documentId).toBe("luat-mau-01");
      expect(document.hasOriginal).toBe(true);
      expect(document.mediaType).toBe("text/plain");
      expect(document.sourceSha256).toBe(
        sha256Ref(text("Điều 1. Phạm vi\nNội dung")),
      );

      const queued = await prisma.outboxMessage.findMany({
        where: {
          eventType: LEGAL_SOURCE_DOCUMENT_INGEST_COMMAND,
          aggregateId: draft.id,
        },
      });
      expect(queued).toHaveLength(1);
      expect(queued[0].payload).toMatchObject({
        documentRowId: document.id,
        attempt: 1,
        legalSourceVersionId: draft.id,
      });

      const blob = await prisma.legalSourceDocumentBlob.findUnique({
        where: { sha256: document.sourceSha256.replace("sha256:", "") },
      });
      expect(blob?.byteLength).toBe(text("Điều 1. Phạm vi\nNội dung").length);
    });

    it("refuses duplicates, unsupported bytes, empty files and oversize files", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      await upload(draft.id, "a.txt", "same words");

      await expect(
        upload(draft.id, "b.txt", "same words"),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.documentDuplicate } },
      });
      await expect(
        documents.addUpload({
          versionId: draft.id,
          actorId: ADMIN,
          correlationId: correlation(),
          bytes: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]),
          declaredType: "application/x-msdownload",
          metadata: { fileName: "tool.exe", structureProfile: Profiles.AUTO },
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.documentUnsupportedMediaType } },
      });
      await expect(
        documents.addUpload({
          versionId: draft.id,
          actorId: ADMIN,
          correlationId: correlation(),
          bytes: Buffer.alloc(0),
          declaredType: "text/plain",
          metadata: { fileName: "e.txt", structureProfile: Profiles.AUTO },
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.documentEmpty } },
      });
      await expect(
        documents.addUpload({
          versionId: draft.id,
          actorId: ADMIN,
          correlationId: correlation(),
          bytes: Buffer.alloc(25 * 1024 * 1024 + 1, 0x61),
          declaredType: "text/plain",
          metadata: { fileName: "big.txt", structureProfile: Profiles.AUTO },
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.documentTooLarge } },
      });
    });

    it("gives two documents with the same title distinct ids", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      const first = await upload(draft.id, "Law.txt", "first body");
      const second = await upload(
        draft.id,
        "Law.md",
        "second body",
        "text/markdown",
      );
      expect([first.documentId, second.documentId]).toEqual(["law", "law-2"]);
    });

    it("imports a URL as a snapshot with provenance and never re-fetches it", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      fetcher.fetch.mockResolvedValue({
        bytes: text("<!doctype html><html><body>Quy định</body></html>"),
        contentType: "text/html",
        requestedUrl: "https://example.org/short",
        finalUrl: "https://example.org/long/quy-dinh.html",
        status: 200,
        redirects: 1,
        etag: '"v1"',
        lastModified: null,
        fileName: "quy-dinh.html",
        retrievedAt: new Date("2026-10-14T01:00:00.000Z"),
      });

      const document = await documents.importFromUrl({
        versionId: draft.id,
        actorId: ADMIN,
        correlationId: correlation(),
        request: {
          url: "https://example.org/short",
          structureProfile: Profiles.AUTO,
          sourceEffectStatus: "IN_FORCE",
        },
      });

      expect(document.origin).toBe("URL_IMPORT");
      expect(document.sourceUrl).toBe("https://example.org/long/quy-dinh.html");
      expect(document.mediaType).toBe("text/html");
      expect(document.sourceEffectStatus).toBe("IN_FORCE");
      expect(document.provenance).toMatchObject({
        requestedUrl: "https://example.org/short",
        finalUrl: "https://example.org/long/quy-dinh.html",
        retrievedAt: "2026-10-14T01:00:00.000Z",
        redirects: 1,
        etag: '"v1"',
      });
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);

      // Retrying ingestion reads the stored snapshot; the live URL is not requested again.
      await documents.retry({
        versionId: draft.id,
        documentRowId: document.id,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      expect(fetcher.fetch).toHaveBeenCalledTimes(1);
    });

    it("turns a rejected import into a problem and keeps nothing", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      fetcher.fetch.mockRejectedValue(
        new ImportRejectedError(Reasons.ADDRESS_NOT_PUBLIC),
      );

      await expect(
        documents.importFromUrl({
          versionId: draft.id,
          actorId: ADMIN,
          correlationId: correlation(),
          request: {
            url: "https://internal.example/x",
            structureProfile: Profiles.AUTO,
          },
        }),
      ).rejects.toMatchObject({
        response: {
          problem: {
            code: Errors.importUrlRejected,
            meta: { reason: Reasons.ADDRESS_NOT_PUBLIC },
          },
        },
      });
      const detail = await management.getVersion(draft.id, correlation());
      expect(detail.documents).toEqual([]);
    });
  });

  describe("ingestion results", () => {
    it("writes version-qualified chunks, marks the document READY and validates the version", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      const document = await upload(draft.id, "a.txt", `body ${randomUUID()}`);

      const applied = await ingest(document.id, 1, ["sec-1", "sec-2", "sec-3"]);
      expect(applied).toEqual({ applied: true, state: States.READY });

      const detail = await management.getVersion(draft.id, correlation());
      expect(detail.documents[0]).toMatchObject({
        ingestionState: States.READY,
        chunkCount: 3,
        structureProfile: Profiles.PARAGRAPHS,
        extraction: expect.objectContaining({ tool: "test-extractor" }),
      });
      expect(detail.index?.status).toBe("VALID");
      expect(detail.blockers).toEqual([]);
      expect(detail.canActivate).toBe(true);

      const chunks = await prisma.legalDocumentChunk.findMany({
        where: { legalSourceVersionId: draft.id },
        orderBy: { locator: "asc" },
      });
      expect(chunks.map((chunk) => chunk.id)).toEqual(
        ["sec-1", "sec-2", "sec-3"].map(
          (locator) => `${draft.id}::a::${locator}`,
        ),
      );
      expect(chunks.every((chunk) => chunk.legalStatus === "ACTIVE")).toBe(
        true,
      );
    });

    it("ignores a stale or duplicated result and keeps the newer outcome", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      const document = await upload(draft.id, "a.txt", `body ${randomUUID()}`);

      await documents.recordIngestionResult({
        documentRowId: document.id,
        result: {
          outcome: "FAILED",
          attempt: 1,
          failureCode: "EXTRACTION_FAILED",
        },
        correlationId: correlation(),
      });
      const retried = await documents.retry({
        versionId: draft.id,
        documentRowId: document.id,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      expect(retried.attempt).toBe(2);
      expect(retried.ingestionState).toBe(States.PENDING);
      expect(retried.failureCode).toBeNull();

      // The first attempt answers late.
      const stale = await ingest(document.id, 1, ["late"]);
      expect(stale.applied).toBe(false);
      expect(
        await prisma.legalDocumentChunk.count({
          where: { legalSourceVersionId: draft.id },
        }),
      ).toBe(0);

      const current = await ingest(document.id, 2, ["now"]);
      expect(current.applied).toBe(true);
      const duplicate = await ingest(document.id, 2, ["now"]);
      expect(duplicate.applied).toBe(false);
    });

    it("records a failure with its code, blocks activation, and allows a retry only until READY", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      const document = await upload(draft.id, "a.txt", `body ${randomUUID()}`);

      await documents.recordIngestionResult({
        documentRowId: document.id,
        result: {
          outcome: "FAILED",
          attempt: 1,
          failureCode: "NO_EXTRACTABLE_TEXT",
        },
        correlationId: correlation(),
      });
      const failed = await management.getVersion(draft.id, correlation());
      expect(failed.documents[0]).toMatchObject({
        ingestionState: States.FAILED,
        failureCode: "NO_EXTRACTABLE_TEXT",
        canRetry: true,
      });
      expect(failed.blockers).toContain(Blockers.DOCUMENT_NOT_READY);
      await expect(
        management.activate({
          versionId: draft.id,
          actorId: ADMIN,
          correlationId: correlation(),
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.versionNotReady } },
      });

      await documents.retry({
        versionId: draft.id,
        documentRowId: document.id,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      await ingest(document.id, 2, ["ok"]);
      await expect(
        documents.retry({
          versionId: draft.id,
          documentRowId: document.id,
          actorId: ADMIN,
          correlationId: correlation(),
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.documentNotRetryable } },
      });
    });

    it("rejects a result whose chunk hash does not match its text", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      const document = await upload(draft.id, "a.txt", `body ${randomUUID()}`);
      const result = readyResult(1, [{ locator: "x", content: "text" }]);
      if (result.outcome !== "READY") throw new Error("fixture");
      result.chunks[0].contentSha256 = sha256Ref("different");

      await expect(
        documents.recordIngestionResult({
          documentRowId: document.id,
          result,
          correlationId: correlation(),
        }),
      ).rejects.toBeDefined();
      expect(
        await prisma.legalDocumentChunk.count({
          where: { legalSourceVersionId: draft.id },
        }),
      ).toBe(0);
    });

    it("removing a document drops its chunks and the version's validation", async () => {
      const source = await newSource();
      const { versionId, documentRowId } = await readyDraft(
        source.id,
        "removable",
      );
      expect(
        (await management.getVersion(versionId, correlation())).index?.status,
      ).toBe("VALID");

      await documents.remove({
        versionId,
        documentRowId,
        actorId: ADMIN,
        correlationId: correlation(),
      });

      const detail = await management.getVersion(versionId, correlation());
      expect(detail.documents).toEqual([]);
      expect(detail.index).toBeNull();
      expect(
        await prisma.legalDocumentChunk.count({
          where: { legalSourceVersionId: versionId },
        }),
      ).toBe(0);
    });
  });

  describe("activation, immutability and new versions", () => {
    it("activates a validated draft, supersedes the previous active version, and freezes it", async () => {
      const source = await newSource();
      const first = await readyDraft(source.id, "first");
      const activatedFirst = await management.activate({
        versionId: first.versionId,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      expect(activatedFirst.status).toBe(Lifecycle.active);
      expect(activatedFirst.canActivate).toBe(false);
      expect(activatedFirst.blockers).toEqual([Blockers.VERSION_NOT_DRAFT]);

      // Activation is idempotent.
      const again = await management.activate({
        versionId: first.versionId,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      expect(again.status).toBe(Lifecycle.active);

      // The announcement that starts rule-set preparation was queued exactly once.
      expect(
        await prisma.outboxMessage.count({
          where: {
            aggregateId: first.versionId,
            eventType: "event.legal-source.activated.v1",
          },
        }),
      ).toBe(1);

      // Frozen: no document can be added, removed, retried or discarded, and the database agrees.
      await expect(
        upload(first.versionId, "late.txt", "too late"),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.versionImmutable } },
      });
      await expect(
        documents.remove({
          versionId: first.versionId,
          documentRowId: first.documentRowId,
          actorId: ADMIN,
          correlationId: correlation(),
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.versionImmutable } },
      });
      await expect(
        management.discard({
          versionId: first.versionId,
          actorId: ADMIN,
          correlationId: correlation(),
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.versionImmutable } },
      });
      await expect(
        prisma.legalDocumentChunk.updateMany({
          where: { legalSourceVersionId: first.versionId },
          data: { content: "rewritten" },
        }),
      ).rejects.toThrow(/LEGAL_SOURCE_VERSION_IMMUTABLE/u);
      await expect(
        prisma.legalSourceDocument.update({
          where: { id: first.documentRowId },
          data: { title: "rewritten" },
        }),
      ).rejects.toThrow(/LEGAL_SOURCE_VERSION_IMMUTABLE/u);

      // A second source activates over it: the platform keeps one active version.
      const other = await newSource();
      const second = await readyDraft(other.id, "second");
      await management.activate({
        versionId: second.versionId,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      expect(
        (await management.getVersion(first.versionId, correlation())).status,
      ).toBe(Lifecycle.superseded);
      expect(
        (await management.getVersion(second.versionId, correlation())).status,
      ).toBe(Lifecycle.active);
    });

    it("starts a new draft from an earlier version without touching it, with its own chunk ids", async () => {
      const source = await newSource();
      const base = await readyDraft(source.id, "carried", ["art-1", "art-2"]);
      await management.activate({
        versionId: base.versionId,
        actorId: ADMIN,
        correlationId: correlation(),
      });

      const next = await newDraft(source.id, base.versionId);

      expect(next.id).not.toBe(base.versionId);
      expect(next.basedOnVersionId).toBe(base.versionId);
      expect(next.version).toBe(`${source.slug}.v2`);
      expect(next.documents).toHaveLength(1);
      expect(next.documents[0]).toMatchObject({
        ingestionState: States.READY,
        chunkCount: 2,
        hasOriginal: true,
      });
      expect(next.canActivate).toBe(true);
      expect(next.index?.status).toBe("VALID");

      const baseChunks = await prisma.legalDocumentChunk.findMany({
        where: { legalSourceVersionId: base.versionId },
      });
      const nextChunks = await prisma.legalDocumentChunk.findMany({
        where: { legalSourceVersionId: next.id },
      });
      expect(nextChunks.map((chunk) => chunk.id).sort()).not.toEqual(
        baseChunks.map((chunk) => chunk.id).sort(),
      );
      expect(nextChunks.map((chunk) => chunk.contentSha256).sort()).toEqual(
        baseChunks.map((chunk) => chunk.contentSha256).sort(),
      );

      // Adding a document to the new draft leaves the active base unchanged.
      const added = await upload(next.id, "extra.txt", `extra ${randomUUID()}`);
      await ingest(added.id, 1, ["x-1"]);
      const baseAfter = await management.getVersion(
        base.versionId,
        correlation(),
      );
      expect(baseAfter.documentCount).toBe(1);
      expect(baseAfter.chunkCount).toBe(2);
      const nextAfter = await management.getVersion(next.id, correlation());
      expect(nextAfter.documentCount).toBe(2);

      // Activating the new version supersedes the base, which stays readable forever.
      await management.activate({
        versionId: next.id,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      const superseded = await management.getVersion(
        base.versionId,
        correlation(),
      );
      expect(superseded.status).toBe(Lifecycle.superseded);
      expect(superseded.chunkCount).toBe(2);
    });
  });

  describe("discarding drafts", () => {
    it("deletes an unreferenced draft and its orphaned originals", async () => {
      const source = await newSource();
      const { versionId, documentRowId } = await readyDraft(source.id, "temp");
      const document = await prisma.legalSourceDocument.findUniqueOrThrow({
        where: { id: documentRowId },
      });
      expect(
        await prisma.legalSourceDocumentBlob.count({
          where: { sha256: document.blobSha256! },
        }),
      ).toBe(1);

      await management.discard({
        versionId,
        actorId: ADMIN,
        correlationId: correlation(),
      });

      expect(
        await prisma.legalSourceVersion.findUnique({
          where: { id: versionId },
        }),
      ).toBeNull();
      expect(
        await prisma.legalDocumentChunk.count({
          where: { legalSourceVersionId: versionId },
        }),
      ).toBe(0);
      expect(
        await prisma.legalSourceDocumentBlob.count({
          where: { sha256: document.blobSha256! },
        }),
      ).toBe(0);
      expect(
        (await management.getSource(source.id, correlation())).canCreateVersion,
      ).toBe(true);
    });

    it("keeps an original that another version still references", async () => {
      const source = await newSource();
      const base = await readyDraft(source.id, "shared");
      await management.activate({
        versionId: base.versionId,
        actorId: ADMIN,
        correlationId: correlation(),
      });
      const copy = await newDraft(source.id, base.versionId);
      const sha = (
        await prisma.legalSourceDocument.findFirstOrThrow({
          where: { legalSourceVersionId: copy.id },
        })
      ).blobSha256!;

      await management.discard({
        versionId: copy.id,
        actorId: ADMIN,
        correlationId: correlation(),
      });

      expect(
        await prisma.legalSourceDocumentBlob.count({ where: { sha256: sha } }),
      ).toBe(1);
    });

    it("refuses to delete a draft that a Preparation run points at", async () => {
      const source = await newSource();
      const draft = await newDraft(source.id);
      await prisma.ruleSetPreparationRun.create({
        data: {
          idempotencyKey: `pin-${randomUUID()}`,
          legalSourceVersionId: draft.id,
          requestedBy: ADMIN,
          correlationId: "pin",
        },
      });
      const detail = await management.getVersion(draft.id, correlation());
      expect(detail.canDiscard).toBe(false);

      await expect(
        management.discard({
          versionId: draft.id,
          actorId: ADMIN,
          correlationId: correlation(),
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.versionInUse } },
      });
      expect(
        await prisma.legalSourceVersion.findUnique({ where: { id: draft.id } }),
      ).not.toBeNull();
    });
  });

  describe("reading", () => {
    it("serves chunks page by page and the stored original", async () => {
      const source = await newSource();
      const { versionId, documentRowId } = await readyDraft(
        source.id,
        "readable",
        ["p-1", "p-2", "p-3"],
      );

      const page = await documents.listChunks({
        documentRowId,
        versionId,
        query: { page: 2, pageSize: 2 },
        correlationId: correlation(),
      });
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);

      const original = await documents.readOriginal(
        documentRowId,
        { versionId },
        correlation(),
      );
      expect(original.mediaType).toBe("text/plain");
      expect(original.bytes.toString("utf8")).toMatch(/^Document readable /u);
      expect(sha256Ref(original.bytes)).toBe(`sha256:${original.sha256}`);

      // Other versions' documents are not reachable through this one, nor through the public view.
      await expect(
        documents.listChunks({
          documentRowId,
          versionId: randomUUID(),
          query: { page: 1, pageSize: 10 },
          correlationId: correlation(),
        }),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.documentNotFound } },
      });
      await expect(
        documents.readOriginal(
          documentRowId,
          { activeOnly: true },
          correlation(),
        ),
      ).rejects.toMatchObject({
        response: { problem: { code: Errors.documentNotFound } },
      });
    });

    it("lists the active library with document metadata after activation", async () => {
      const source = await newSource();
      const { versionId } = await readyDraft(source.id, "public");
      await management.activate({
        versionId,
        actorId: ADMIN,
        correlationId: correlation(),
      });

      const library = await management.getActiveLibrary(correlation());

      expect(library.versionId).toBe(versionId);
      expect(library.sourceName).toBe(source.name);
      expect(library.documents).toHaveLength(1);
      expect(library.documents[0]).toMatchObject({
        chunkCount: 2,
        hasOriginal: true,
      });
    });
  });
});
