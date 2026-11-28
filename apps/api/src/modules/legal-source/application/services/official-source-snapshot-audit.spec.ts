import { describe, expect, it, jest } from "@jest/globals";
import { Prisma } from "@prisma/client";
import { LEGAL_SOURCE_ERROR_CODES } from "@lcsp/contracts/legal-source";

import { OfficialSourceSnapshotService } from "./official-source-snapshot.service.js";

const sha = "0123456789abcdef".repeat(4);
const snapshotInput = () => ({
  snapshotRef: "snapshot:LAW-71-2025-QH15:abcd1234ef56",
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
  provenanceRef: "prov:fetch:LAW-71-2025-QH15:abcd1234ef56",
  retrievedAt: "2026-08-12T10:00:00.000Z",
  sourceEffectStatus: "CURRENT",
  normalizationSource: "VBPL_GATEWAY_JSON",
  documentIdentityVerified: true,
});

const storedSnapshot = () => ({
  ...snapshotInput(),
  snapshotId: "LAW-71-2025-QH15:abcd1234ef56",
  identityVerified: true,
  createdAt: new Date("2026-08-12T10:00:00.000Z"),
  retrievedAt: new Date("2026-08-12T10:00:00.000Z"),
  correlationId: "red-test",
});

describe("RED: legal source evidence and replay boundaries", () => {
  it("rolls back a new official snapshot if its audit write fails", async () => {
    // Why: A persisted snapshot without its audit cannot later be repaired by ordinary replay.
    // How: Make audit fail after the mocked persistence write and inspect durable state.
    // Invariant: Snapshot and audit must commit or roll back together.
    let persisted: object | null = null;
    let pending: object | null = null;
    const createInTx = jest
      .fn<() => Promise<ReturnType<typeof storedSnapshot>>>()
      .mockImplementation(() => {
        pending = storedSnapshot();
        return Promise.resolve(storedSnapshot());
      });
    const tx = { legalSourceSnapshot: { create: createInTx } };
    const prisma = {
      legalSourceSnapshot: {
        findUnique: jest
          .fn<() => Promise<object | null>>()
          .mockResolvedValue(null),
        create: jest
          .fn<() => Promise<ReturnType<typeof storedSnapshot>>>()
          .mockImplementation(() => {
            persisted = storedSnapshot();
            return Promise.resolve(storedSnapshot());
          }),
      },
      $transaction: async (work: (client: typeof tx) => Promise<unknown>) => {
        const result = await work(tx);
        persisted = pending;
        return result;
      },
    };
    const audit = {
      write: jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("audit unavailable")),
      writeInTx: jest
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("audit unavailable")),
    };
    const service = new OfficialSourceSnapshotService(
      prisma as never,
      audit as never,
    );
    await expect(
      service.register(snapshotInput(), "red-test"),
    ).rejects.toThrow();
    expect(
      audit.write.mock.calls.length + audit.writeInTx.mock.calls.length,
    ).toBeGreaterThan(0);
    expect(persisted).toBeNull();
  });

  it("replays an identical concurrent snapshot registration after a unique race", async () => {
    // Why: Two workers may observe absence before either snapshot insert commits.
    // How: Reproduce the losing insert with Prisma P2002 and expose the winning row on reread.
    // Invariant: Identical retries return the immutable winner, not a generic server error.
    const uniqueRace = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["snapshotRef"] },
      },
    );
    const prisma = {
      legalSourceSnapshot: {
        findUnique: jest
          .fn<() => Promise<ReturnType<typeof storedSnapshot> | null>>()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(storedSnapshot()),
      },
      // Why: A unique race aborts the insert transaction before the committed winner can be reloaded.
      // How: The transaction delegate rejects, while the root client exposes the winner on the second read.
      // Invariant: Retry recovery happens outside the rolled-back transaction.
      $transaction: async (work: (tx: object) => Promise<unknown>) =>
        work({
          legalSourceSnapshot: {
            create: jest
              .fn<() => Promise<never>>()
              .mockRejectedValue(uniqueRace),
          },
        }),
    };
    const service = new OfficialSourceSnapshotService(
      prisma as never,
      { write: jest.fn() } as never,
    );
    await expect(
      service.register(snapshotInput(), "red-test"),
    ).resolves.toMatchObject({
      snapshotRef: snapshotInput().snapshotRef,
    });
  });

  it("recognizes the installed PostgreSQL adapter's exact snapshot-reference constraint", async () => {
    // Why: Prisma 7 reports the violated index under driverAdapterError rather than meta.target.
    // How: Reproduce the observed nested P2002 metadata without relying on its error message.
    // Invariant: A committed identical winner is replayed only for this exact index.
    const uniqueRace = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "7.10.1",
        meta: {
          modelName: "LegalSourceSnapshot",
          driverAdapterError: {
            cause: {
              kind: "UniqueConstraintViolation",
              constraint: { index: "LegalSourceSnapshot_snapshotRef_key" },
            },
          },
        },
      },
    );
    const service = new OfficialSourceSnapshotService(
      {
        legalSourceSnapshot: {
          findUnique: jest
            .fn<() => Promise<ReturnType<typeof storedSnapshot> | null>>()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(storedSnapshot()),
        },
        $transaction: jest
          .fn<() => Promise<never>>()
          .mockRejectedValue(uniqueRace),
      } as never,
      {} as never,
    );
    await expect(
      service.register(snapshotInput(), "red-test"),
    ).resolves.toMatchObject({
      snapshotRef: snapshotInput().snapshotRef,
    });
  });

  it("rejects a conflicting winner after a snapshot-reference unique race", async () => {
    // Why: A concurrent worker can win the same reference with different immutable evidence.
    // How: Reload the committed winner after P2002 and compare its hash with the requested payload.
    // Invariant: A reused reference never aliases another document's bytes.
    const uniqueRace = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: "LegalSourceSnapshot_snapshotRef_key" },
      },
    );
    const prisma = {
      legalSourceSnapshot: {
        findUnique: jest
          .fn<() => Promise<ReturnType<typeof storedSnapshot> | null>>()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            ...storedSnapshot(),
            contentSha256: `sha256:${"f".repeat(64)}`,
          }),
      },
      $transaction: jest
        .fn<() => Promise<never>>()
        .mockRejectedValue(uniqueRace),
    };
    const service = new OfficialSourceSnapshotService(
      prisma as never,
      {} as never,
    );
    await expect(
      service.register(snapshotInput(), "red-test"),
    ).rejects.toMatchObject({
      response: {
        problem: { code: LEGAL_SOURCE_ERROR_CODES.sourceSnapshotConflict },
      },
    });
  });

  it("does not mask a unique failure on an unrelated database constraint", async () => {
    // Why: An audit or another unique index can fail independently of snapshotRef.
    // How: Fail the transaction with an unrelated P2002 target.
    // Invariant: Only the exact snapshot-reference race may enter idempotent replay.
    const unrelated = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["otherConstraint"] },
      },
    );
    const findUnique = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const service = new OfficialSourceSnapshotService(
      {
        legalSourceSnapshot: { findUnique },
        $transaction: jest
          .fn<() => Promise<never>>()
          .mockRejectedValue(unrelated),
      } as never,
      {} as never,
    );
    await expect(service.register(snapshotInput(), "red-test")).rejects.toBe(
      unrelated,
    );
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("does not replay another model's same-named unique field", async () => {
    // Why: A generic meta.target field can occur on another table after the snapshot insert succeeds.
    // How: Attach a different explicit model name to an otherwise matching target.
    // Invariant: Required audit or other-table failures must propagate, never become a successful replay.
    const otherModelRace = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "7.10.1",
        meta: { modelName: "AuditEvent", target: ["snapshotRef"] },
      },
    );
    const service = new OfficialSourceSnapshotService(
      {
        legalSourceSnapshot: {
          findUnique: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        },
        $transaction: jest
          .fn<() => Promise<never>>()
          .mockRejectedValue(otherModelRace),
      } as never,
      {} as never,
    );
    await expect(service.register(snapshotInput(), "red-test")).rejects.toBe(
      otherModelRace,
    );
  });
});
