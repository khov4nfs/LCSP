import { describe, expect, it, jest } from "@jest/globals";

import { OfficialSourceSnapshotService } from "./official-source-snapshot.service.js";

describe("OfficialSourceSnapshotService", () => {
  it("registers a new immutable snapshot record", async () => {
    const create = jest
      .fn<() => Promise<Record<string, unknown>>>()
      .mockResolvedValue({
        snapshotRef: "snapshot:LAW-71-2025-QH15:abcd1234ef56",
        snapshotId: "LAW-71-2025-QH15:abcd1234ef56",
        catalogSourceRef: "catalog-source:vbpl.vn:law:71-2025-qh15",
        adminCatalogVersion: "catalog_v2026_08",
        documentId: "LAW-71-2025-QH15",
        documentNumber: "71/2025/QH15",
        sourceUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
        finalUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
        contentType: "text/html",
        byteLength: 2048,
        contentSha256:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        snapshotObjectKey:
          "legal-source-snapshots/catalog_vbpl_vn/LAW-71-2025-QH15/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/LAW-71-2025-QH15.source.html",
        provenanceRef: "prov:fetch:LAW-71-2025-QH15:abcd1234ef56",
        retrievedAt: new Date("2026-08-12T10:00:00.000Z"),
        sourceEffectStatus: "Còn hiệu lực",
        normalizationSource: "VBPL_GATEWAY_JSON",
        identityVerified: true,
        correlationId: "corr-1",
        createdAt: new Date("2026-08-12T10:00:00.000Z"),
      });
    const prisma = {
      legalSourceSnapshot: {
        findUnique: jest
          .fn<(args?: unknown) => Promise<Record<string, unknown> | null>>()
          .mockResolvedValue(null),
        create,
      },
    };
    const auditWriter = {
      write: jest
        .fn<(entry?: unknown) => Promise<void>>()
        .mockResolvedValue(undefined),
    };
    const service = new OfficialSourceSnapshotService(
      prisma as never,
      auditWriter as never,
    );

    const result = await service.register(
      {
        snapshotRef: "snapshot:LAW-71-2025-QH15:abcd1234ef56",
        catalogSourceRef: "catalog-source:vbpl.vn:law:71-2025-qh15",
        adminCatalogVersion: "catalog_v2026_08",
        documentId: "LAW-71-2025-QH15",
        documentNumber: "71/2025/QH15",
        sourceUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
        finalUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
        contentType: "text/html",
        byteLength: 2048,
        contentSha256:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        snapshotObjectKey:
          "legal-source-snapshots/catalog_vbpl_vn/LAW-71-2025-QH15/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/LAW-71-2025-QH15.source.html",
        provenanceRef: "prov:fetch:LAW-71-2025-QH15:abcd1234ef56",
        retrievedAt: "2026-08-12T10:00:00.000Z",
        sourceEffectStatus: "Còn hiệu lực",
        normalizationSource: "VBPL_GATEWAY_JSON",
        documentIdentityVerified: true,
      },
      "corr-1",
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.snapshotRef).toBe("snapshot:LAW-71-2025-QH15:abcd1234ef56");
    expect(auditWriter.write).toHaveBeenCalledTimes(1);
  });

  it("returns existing record for identical replay", async () => {
    const existing = {
      snapshotRef: "snapshot:LAW-71-2025-QH15:abcd1234ef56",
      snapshotId: "LAW-71-2025-QH15:abcd1234ef56",
      catalogSourceRef: "catalog-source:vbpl.vn:law:71-2025-qh15",
      adminCatalogVersion: "catalog_v2026_08",
      documentId: "LAW-71-2025-QH15",
      documentNumber: "71/2025/QH15",
      sourceUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
      finalUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=179989",
      contentType: "text/html",
      byteLength: 2048,
      contentSha256:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      snapshotObjectKey:
        "legal-source-snapshots/catalog_vbpl_vn/LAW-71-2025-QH15/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/LAW-71-2025-QH15.source.html",
      provenanceRef: "prov:fetch:LAW-71-2025-QH15:abcd1234ef56",
      retrievedAt: new Date("2026-08-12T10:00:00.000Z"),
      sourceEffectStatus: "Còn hiệu lực",
      normalizationSource: "VBPL_GATEWAY_JSON",
      identityVerified: true,
      correlationId: "corr-1",
      createdAt: new Date("2026-08-12T10:00:00.000Z"),
    };
    const prisma = {
      legalSourceSnapshot: {
        findUnique: jest
          .fn<(args?: unknown) => Promise<Record<string, unknown> | null>>()
          .mockResolvedValue(existing),
        create: jest.fn<(args?: unknown) => Promise<Record<string, unknown>>>(),
      },
    };
    const service = new OfficialSourceSnapshotService(
      prisma as never,
      {
        write: jest.fn<(entry?: unknown) => Promise<void>>(),
      } as never,
    );

    const result = await service.register(
      {
        snapshotRef: existing.snapshotRef,
        catalogSourceRef: existing.catalogSourceRef,
        adminCatalogVersion: existing.adminCatalogVersion,
        documentId: existing.documentId,
        documentNumber: existing.documentNumber,
        sourceUrl: existing.sourceUrl,
        finalUrl: existing.finalUrl,
        contentType: existing.contentType,
        byteLength: existing.byteLength,
        contentSha256: existing.contentSha256,
        snapshotObjectKey: existing.snapshotObjectKey,
        provenanceRef: existing.provenanceRef,
        retrievedAt: existing.retrievedAt.toISOString(),
        sourceEffectStatus: existing.sourceEffectStatus,
        normalizationSource: existing.normalizationSource,
        documentIdentityVerified: existing.identityVerified,
      },
      "corr-1",
    );

    expect(prisma.legalSourceSnapshot.create).not.toHaveBeenCalled();
    expect(result.snapshotId).toBe(existing.snapshotId);
  });
});
