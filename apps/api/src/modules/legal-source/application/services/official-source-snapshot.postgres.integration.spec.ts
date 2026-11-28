import { randomUUID } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { OfficialSourceSnapshotService } from "./official-source-snapshot.service.js";

const rawUrl = process.env.DATABASE_URL ?? "";
const url = rawUrl ? new URL(rawUrl) : null;
const dedicated =
  url?.hostname === "127.0.0.1" &&
  url.port === "55446" &&
  url.pathname === "/lcsp_legal_source_race_test";
const database = dedicated ? describe : describe.skip;
const sha = "0123456789abcdef".repeat(4);

function request(snapshotRef: string) {
  return {
    snapshotRef,
    catalogSourceRef: "catalog-source:vbpl.vn:law:71-2025-qh15",
    adminCatalogVersion: "catalog_v2026_08",
    documentId: "LAW-71-2025-QH15",
    documentNumber: "71/2025/QH15",
    sourceUrl: "https://vbpl.vn/law.html",
    finalUrl: "https://vbpl.vn/law.html",
    contentType: "text/html",
    byteLength: 2048,
    contentSha256: `sha256:${sha}`,
    snapshotObjectKey: `legal-source-snapshots/catalog_vbpl_vn/LAW-71-2025-QH15/${sha}/LAW-71-2025-QH15.source.html`,
    provenanceRef: `prov:fetch:${snapshotRef}`,
    retrievedAt: "2026-08-12T10:00:00.000Z",
    sourceEffectStatus: "CURRENT",
    normalizationSource: "VBPL_GATEWAY_JSON",
    documentIdentityVerified: true,
  };
}

database("Official Source Snapshot PostgreSQL transaction", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ adapter: new PrismaPg(rawUrl) });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("rolls back the snapshot when the required audit write fails", async () => {
    // Why: Immutable source evidence without a matching audit event cannot be repaired by normal replay.
    // How: Fail the audit inside the real PostgreSQL transaction and inspect both durable tables.
    // Invariant: No snapshot or audit is committed on the failed registration.
    const snapshotRef = `snapshot:LAW-71-2025-QH15:${randomUUID()}`;
    const service = new OfficialSourceSnapshotService(
      prisma as never,
      {
        writeInTx: () => Promise.reject(new Error("audit unavailable")),
      } as never,
    );
    await expect(
      service.register(request(snapshotRef), randomUUID()),
    ).rejects.toThrow("audit unavailable");
    expect(
      await prisma.legalSourceSnapshot.count({ where: { snapshotRef } }),
    ).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: {
          eventType: "LEGAL_SOURCE_SNAPSHOT_STORED",
          resourceId: snapshotRef,
        },
      }),
    ).toBe(0);
  });

  it("converges two simultaneous identical registrations to one snapshot and audit", async () => {
    // Why: Both workers can observe absence before either transaction inserts the immutable snapshot.
    // How: Hold both first reads at a barrier, then register against the real unique indexes concurrently.
    // Invariant: Exactly one snapshot/audit pair commits and both callers receive the same snapshot identity.
    const snapshotRef = `snapshot:LAW-71-2025-QH15:${randomUUID()}`;
    let arrivals = 0;
    let releaseReads: (() => void) | undefined;
    const readsReleased = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    const service = new OfficialSourceSnapshotService(
      {
        legalSourceSnapshot: {
          findUnique: async (
            args: Parameters<typeof prisma.legalSourceSnapshot.findUnique>[0],
          ) => {
            const found = await prisma.legalSourceSnapshot.findUnique(args);
            arrivals += 1;
            if (arrivals === 2) releaseReads?.();
            await readsReleased;
            return found;
          },
        },
        $transaction: (work: Parameters<typeof prisma.$transaction>[0]) =>
          prisma.$transaction(work as never),
      } as never,
      new AuditWriterService(prisma as never),
    );
    const payload = request(snapshotRef);
    const [first, second] = await Promise.all([
      service.register(payload, randomUUID()),
      service.register(payload, randomUUID()),
    ]);
    expect(first.snapshotId).toBe(second.snapshotId);
    expect(
      await prisma.legalSourceSnapshot.count({ where: { snapshotRef } }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          eventType: "LEGAL_SOURCE_SNAPSHOT_STORED",
          resourceId: snapshotRef,
        },
      }),
    ).toBe(1);
  });
});
