import { createHash } from "node:crypto";

import {
  LEGACY_MIGRATION_ERROR_CODES,
  LEGACY_MIGRATION_AUDIT_EVENT_TYPES,
} from "@lcsp/contracts/legacy-migration";
import { describe, expect, it, jest } from "@jest/globals";

import type { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import type {
  ArchivedReportDownload,
  LegacyArchiveReadRepository,
} from "../../infrastructure/persistence/legacy-archive-read.repository.js";
import type { LegacyArchiveBlobStore } from "../../infrastructure/storage/legacy-archive-blob.store.js";
import { DownloadLegacyArchiveReportHandler } from "./download-legacy-archive-report/download-legacy-archive-report.handler.js";
import { DownloadLegacyArchiveReportQuery } from "./download-legacy-archive-report/download-legacy-archive-report.query.js";
import { GetLegacyArchiveHandler } from "./get-legacy-archive/get-legacy-archive.handler.js";
import { GetLegacyArchiveQuery } from "./get-legacy-archive/get-legacy-archive.query.js";

const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");

function download(overrides: Partial<ArchivedReportDownload> = {}) {
  const base: ArchivedReportDownload = {
    recordId: "11111111-1111-1111-1111-111111111111",
    assessmentId: "a-1",
    mediaType: "application/pdf",
    extension: "pdf",
    inline: null,
    blob: null,
  };
  return { ...base, ...overrides };
}

function build(target: ArchivedReportDownload | null, stored?: Buffer | Error) {
  const archive = {
    downloadable: jest
      .fn<LegacyArchiveReadRepository["downloadable"]>()
      .mockResolvedValue(target),
  } as unknown as LegacyArchiveReadRepository;
  const blobs = {
    read: jest.fn(() =>
      stored instanceof Error
        ? Promise.reject(stored)
        : Promise.resolve(stored ?? Buffer.alloc(0)),
    ),
  } as unknown as LegacyArchiveBlobStore;
  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const handler = new DownloadLegacyArchiveReportHandler(archive, blobs, {
    write,
  } as unknown as AuditWriterService);
  return { handler, archive, write };
}

const query = () =>
  new DownloadLegacyArchiveReportQuery(
    "owner-1",
    "a-1",
    "11111111-1111-1111-1111-111111111111",
    "corr-1",
  );

describe("DownloadLegacyArchiveReportHandler", () => {
  it("serves a verified byte copy unchanged and audits the read", async () => {
    const bytes = Buffer.from("# legacy report\n");
    const { handler, write } = build(
      download({
        blob: {
          storageRef: "legacy-archive/x.blob",
          contentSha256: sha(bytes),
          sizeBytes: bytes.length,
        },
      }),
      bytes,
    );
    const file = await handler.execute(query());
    expect(file.content.equals(bytes)).toBe(true);
    expect(file.sha256).toBe(sha(bytes));
    expect(file.filename).toBe(
      "legacy-report-11111111-1111-1111-1111-111111111111.pdf",
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType:
          LEGACY_MIGRATION_AUDIT_EVENT_TYPES.LEGACY_ARCHIVE_REPORT_DOWNLOADED,
        actorId: "owner-1",
        assessmentId: "a-1",
      }),
    );
  });

  it("refuses bytes whose hash differs from the recorded one (never serves a corrupted copy)", async () => {
    const bytes = Buffer.from("tampered");
    const { handler, write } = build(
      download({
        blob: {
          storageRef: "legacy-archive/x.blob",
          contentSha256: sha(Buffer.from("original")),
          sizeBytes: bytes.length,
        },
      }),
      bytes,
    );
    await expect(handler.execute(query())).rejects.toMatchObject({
      response: {
        problem: {
          code: LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_ARTIFACT_INTEGRITY_FAILED,
        },
      },
    });
    expect(write).not.toHaveBeenCalled();
  });

  it("refuses when the blob file cannot be read", async () => {
    const { handler } = build(
      download({
        blob: {
          storageRef: "legacy-archive/x.blob",
          contentSha256: "a".repeat(64),
          sizeBytes: 3,
        },
      }),
      new Error("ENOENT"),
    );
    await expect(handler.execute(query())).rejects.toMatchObject({
      response: {
        problem: {
          code: LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_ARTIFACT_INTEGRITY_FAILED,
        },
      },
    });
  });

  it("serves inline exports from the archived row", async () => {
    const inline = Buffer.from(JSON.stringify({ readiness: "x" }));
    const { handler } = build(
      download({ inline, mediaType: "application/json", extension: "json" }),
    );
    const file = await handler.execute(query());
    expect(file.content.equals(inline)).toBe(true);
    expect(file.mediaType).toBe("application/json");
  });

  it("answers not-available (404) when the record is not the caller's or not downloadable", async () => {
    const { handler, write } = build(null);
    await expect(handler.execute(query())).rejects.toMatchObject({
      response: {
        problem: {
          code: LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_ARTIFACT_NOT_AVAILABLE,
          status: 404,
        },
      },
    });
    expect(write).not.toHaveBeenCalled();
  });
});

describe("GetLegacyArchiveHandler", () => {
  it("scopes the lookup to the caller and hides other customers' archives as 404", async () => {
    const detail = jest
      .fn<LegacyArchiveReadRepository["detail"]>()
      .mockResolvedValue(null);
    const handler = new GetLegacyArchiveHandler({
      detail,
    } as unknown as LegacyArchiveReadRepository);
    await expect(
      handler.execute(new GetLegacyArchiveQuery("owner-2", "a-1", "corr-2")),
    ).rejects.toMatchObject({
      response: {
        problem: {
          code: LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_NOT_FOUND,
          status: 404,
        },
      },
    });
    expect(detail).toHaveBeenCalledWith("owner-2", "a-1");
  });
});
