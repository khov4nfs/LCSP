import { describe, expect, it, jest } from "@jest/globals";

import { LegalRuleCatalogController } from "./legal-rule-catalog.controller.js";

describe("LegalRuleCatalogController official source snapshots", () => {
  it("registers a worker-owned official snapshot", async () => {
    const officialSourceSnapshots = {
      register: jest
        .fn<
          (
            input?: unknown,
            correlationId?: string,
          ) => Promise<{ snapshotRef: string }>
        >()
        .mockResolvedValue({ snapshotRef: "snapshot:law:abc" }),
      get: jest.fn<
        (
          query?: unknown,
          correlationId?: string,
        ) => Promise<{ snapshotRef: string }>
      >(),
    };
    const controller = new LegalRuleCatalogController(
      {} as never,
      {} as never,
      {} as never,
      officialSourceSnapshots as never,
      {} as never,
    );

    const result = await controller.registerOfficialSourceSnapshot(
      {
        snapshotRef: "snapshot:law:abc",
        catalogSourceRef: "catalog-source:vbpl.vn:law:abc",
        adminCatalogVersion: "catalog_v2026_08",
        documentId: "LAW-ABC",
        sourceUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=1",
        finalUrl: "https://vbpl.vn/TW/Pages/vbpq-toanvan.aspx?ItemID=1",
        contentType: "text/html",
        byteLength: 1,
        contentSha256:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        snapshotObjectKey:
          "legal-source-snapshots/catalog_vbpl_vn/LAW-ABC/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/LAW-ABC.source.html",
        provenanceRef: "prov:fetch:LAW-ABC:abc",
        retrievedAt: "2026-08-12T10:00:00.000Z",
        documentIdentityVerified: true,
      },
      { correlationId: "corr-1" } as never,
    );

    expect(officialSourceSnapshots.register).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotRef: "snapshot:law:abc",
      }),
      "corr-1",
    );
    expect(result).toEqual({
      ok: true,
      data: { snapshotRef: "snapshot:law:abc" },
    });
  });

  it("reads a stored official snapshot by ref", async () => {
    const officialSourceSnapshots = {
      register:
        jest.fn<
          (
            input?: unknown,
            correlationId?: string,
          ) => Promise<{ snapshotRef: string }>
        >(),
      get: jest
        .fn<
          (
            query?: unknown,
            correlationId?: string,
          ) => Promise<{ snapshotRef: string }>
        >()
        .mockResolvedValue({ snapshotRef: "snapshot:law:abc" }),
    };
    const controller = new LegalRuleCatalogController(
      {} as never,
      {} as never,
      {} as never,
      officialSourceSnapshots as never,
      {} as never,
    );

    const result = await controller.getOfficialSourceSnapshot(
      "snapshot:law:abc",
      undefined,
      { correlationId: "corr-2" } as never,
    );

    expect(officialSourceSnapshots.get).toHaveBeenCalledWith(
      { snapshotRef: "snapshot:law:abc", snapshotId: undefined },
      "corr-2",
    );
    expect(result).toEqual({
      ok: true,
      data: { snapshotRef: "snapshot:law:abc" },
    });
  });
});
