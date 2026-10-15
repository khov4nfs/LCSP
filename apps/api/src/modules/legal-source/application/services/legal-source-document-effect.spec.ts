import { describe, expect, it, jest } from "@jest/globals";
import {
  LEGAL_SOURCE_CHUNK_STATUSES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
  type LegalSourceLifecycleStatus,
} from "@lcsp/contracts/legal-source";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../platform/outbox/outbox.repository.js";
import { LegalSourceDocumentService } from "./legal-source-document.service.js";
import { SafeUrlFetcherService } from "./safe-url-fetcher.service.js";

const versionId = "b763597d-0d3c-4ef5-b792-889a7dab413a";
const documentId = "58988598-ffef-460a-a40d-a38599d3f8ef";

function fixture(
  status: LegalSourceLifecycleStatus = LEGAL_SOURCE_LIFECYCLE_STATUSES.draft,
) {
  const document = {
    id: documentId,
    documentId: "law-text",
    provenance: { importedFrom: "snapshot" },
    chunks: [{ locator: "art-1" }, { locator: "art-2" }],
  };
  const updateArguments: { data?: Record<string, unknown> }[] = [];
  const auditCalls: unknown[][] = [];
  const updateChunks = jest.fn(() => Promise.resolve({ count: 2 }));
  const updateDocument = jest.fn((args: { data?: Record<string, unknown> }) => {
    updateArguments.push(args);
    return Promise.resolve(document);
  });
  const findDocument = jest.fn(() => Promise.resolve(document));
  const tx = {
    $queryRaw: jest.fn(() =>
      Promise.resolve([{ id: versionId, version: "source.v2", status }]),
    ),
    legalSourceDocument: {
      findFirst: findDocument,
      update: updateDocument,
    },
    legalDocumentChunk: { updateMany: updateChunks },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: unknown) => unknown) => work(tx)),
  } as unknown as PrismaService;
  const audit = {
    writeInTx: jest.fn((...args: unknown[]) => {
      auditCalls.push(args);
      return Promise.resolve(undefined);
    }),
  } as unknown as AuditWriterService;
  const service = new LegalSourceDocumentService(
    prisma,
    {} as OutboxRepository,
    audit,
    {} as SafeUrlFetcherService,
  );
  jest.spyOn(service, "ensureStructuralIndex").mockResolvedValue(null);
  const view = jest
    .spyOn(
      service as unknown as {
        view: (...args: unknown[]) => Promise<unknown>;
      },
      "view",
    )
    .mockResolvedValue({ id: documentId });
  return {
    service,
    tx,
    updateChunks,
    updateDocument,
    updateArguments,
    auditCalls,
    findDocument,
    audit,
    view,
  };
}

describe("LegalSourceDocumentService.updateEffect", () => {
  it("sets a cited default and exact-locator legal effect overrides on a draft version", async () => {
    const state = fixture();
    await state.service.updateEffect({
      versionId,
      documentRowId: documentId,
      actorId: "admin-1",
      correlationId: "corr-1",
      request: {
        status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
        sourceRef: "official source metadata, effective date",
        effectiveDate: "2026-03-01",
        provisionStatuses: {
          "art-2": {
            status: LEGAL_SOURCE_CHUNK_STATUSES.REPEALED,
            sourceRef: "pinned source article 9",
          },
        },
      },
    });

    expect(state.updateChunks).toHaveBeenCalledTimes(2);
    expect(state.updateArguments[0]?.data).toMatchObject({
      sourceEffectStatus: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
      provenance: {
        importedFrom: "snapshot",
        legalEffectMetadata: {
          status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE,
          sourceRef: "official source metadata, effective date",
        },
      },
    });
    expect(state.auditCalls).toHaveLength(1);
  });

  it("rejects status overrides with a locator outside the cloned document", async () => {
    const state = fixture();
    await expect(
      state.service.updateEffect({
        versionId,
        documentRowId: documentId,
        actorId: "admin-1",
        correlationId: "corr-2",
        request: {
          status: LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN,
          provisionStatuses: {
            "art-999": { status: LEGAL_SOURCE_CHUNK_STATUSES.EFFECTIVE },
          },
        },
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(state.updateChunks).not.toHaveBeenCalled();
    expect(state.updateDocument).not.toHaveBeenCalled();
  });

  it("keeps a historical activated version immutable", async () => {
    const state = fixture(LEGAL_SOURCE_LIFECYCLE_STATUSES.active);
    await expect(
      state.service.updateEffect({
        versionId,
        documentRowId: documentId,
        actorId: "admin-1",
        correlationId: "corr-3",
        request: {
          status: LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN,
          provisionStatuses: {},
        },
      }),
    ).rejects.toBeInstanceOf(Error);
    expect(state.findDocument).not.toHaveBeenCalled();
    expect(state.updateChunks).not.toHaveBeenCalled();
    expect(state.updateDocument).not.toHaveBeenCalled();
  });

  it("allows unknown status without a fabricated source reference", async () => {
    const state = fixture();
    await state.service.updateEffect({
      versionId,
      documentRowId: documentId,
      actorId: "admin-1",
      correlationId: "corr-4",
      request: {
        status: LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN,
        effectiveDate: null,
        provisionStatuses: {},
      },
    });
    expect(state.updateChunks).toHaveBeenCalledTimes(1);
    expect(state.updateArguments[0]?.data?.sourceEffectStatus).toBe(
      LEGAL_SOURCE_CHUNK_STATUSES.UNKNOWN,
    );
  });
});
