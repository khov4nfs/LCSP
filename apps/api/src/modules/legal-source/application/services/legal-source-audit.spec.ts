import { describe, expect, it, jest } from "@jest/globals";
import { LEGAL_SOURCE_ERROR_CODES } from "@lcsp/contracts/legal-source";

import { LegalSourceService } from "./legal-source.service.js";
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

describe("Legal source evidence and replay boundaries", () => {
  it.each([
    { sourceUrl: "not-a-url" },
    { documentIdentityVerified: undefined },
  ])(
    "rejects malformed worker snapshot payload %o before writing",
    async (override) => {
      // Why: Type-only worker request interfaces disappear at runtime.
      // How: Send malformed identity or URL fields directly through the service boundary.
      // Invariant: Invalid provenance must never reach snapshot persistence.
      const create = jest
        .fn<() => Promise<ReturnType<typeof storedSnapshot>>>()
        .mockResolvedValue(storedSnapshot());
      const tx = { legalSourceSnapshot: { create } };
      const service = new OfficialSourceSnapshotService(
        {
          legalSourceSnapshot: {
            findUnique: jest.fn<() => Promise<null>>().mockResolvedValue(null),
          },
          $transaction: (work: (client: typeof tx) => Promise<unknown>) =>
            work(tx),
        } as never,
        {
          writeInTx: jest
            .fn<() => Promise<void>>()
            .mockResolvedValue(undefined),
        } as never,
      );
      await expect(
        service.register(
          { ...snapshotInput(), ...override } as never,
          "red-test",
        ),
      ).rejects.toMatchObject({
        response: {
          problem: { code: LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid },
        },
      });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("rejects an activation replay whose manifest differs from the original request", async () => {
    // Why: A reused idempotency key must not authorize a different pinned source manifest.
    // How: Return an existing activation record for the same version with another manifest.
    // Invariant: Replay identity includes immutable activation inputs, not just version ID.
    const service = new LegalSourceService(
      {
        legalSourceActivationRecord: {
          findUnique: jest.fn<() => Promise<object>>().mockResolvedValue({
            id: "activation-1",
            legalSourceVersionId: "version-1",
            integrityManifestRef: "integrity:original",
            retrievalValidationRef: "retrieval:original",
            scopeDescription: "test",
            comments: null,
            legalSourceVersion: { id: "version-1", version: "v1" },
          }),
        },
      } as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.activateValidatedLegalSourceVersion({
        legalSourceVersionId: "version-1",
        integrityManifestRef: "integrity:changed",
        retrievalValidationRef: "retrieval:original",
        idempotencyKey: "same-key",
        scopeDescription: "test",
        comments: null,
        correlationId: "red-test",
      }),
    ).rejects.toMatchObject({ response: { problem: { status: 409 } } });
    // Why: Scope is part of the same approved activation authority as the manifest.
    // How: Keep both manifests unchanged while changing only the scope.
    // Invariant: Same-key replay cannot silently widen the approved source scope.
    await expect(
      service.activateValidatedLegalSourceVersion({
        legalSourceVersionId: "version-1",
        integrityManifestRef: "integrity:original",
        retrievalValidationRef: "retrieval:original",
        idempotencyKey: "same-key",
        scopeDescription: "different scope",
        comments: null,
        correlationId: "red-test",
      }),
    ).rejects.toMatchObject({ response: { problem: { status: 409 } } });
    // Why: Exact replay remains idempotent after a mismatched request was rejected.
    // How: Reuse the stored manifests and scope with the same key.
    // Invariant: A conflict does not consume or mutate the original activation record.
    await expect(
      service.activateValidatedLegalSourceVersion({
        legalSourceVersionId: "version-1",
        integrityManifestRef: "integrity:original",
        retrievalValidationRef: "retrieval:original",
        idempotencyKey: "same-key",
        scopeDescription: "test",
        comments: null,
        correlationId: "red-test",
      }),
    ).resolves.toMatchObject({ id: "version-1" });
  });

  it("rejects a retrieval-index replay when its content hash differs", async () => {
    // Why: An index version must identify one immutable content/configuration pair.
    // How: Replay the same version and manifest with changed content hash.
    // Invariant: The response cannot claim VALID for bytes different from the stored index.
    const service = new LegalSourceService(
      {
        legalSourceVersion: {
          findUnique: jest
            .fn<() => Promise<object>>()
            .mockResolvedValue({ id: "source-1", version: "v1" }),
        },
        legalRetrievalIndex: {
          findUnique: jest.fn<() => Promise<object>>().mockResolvedValue({
            id: "index-1",
            legalSourceVersionId: "source-1",
            version: "index-v1",
            status: "VALID",
            validationManifestRef: "manifest:original",
            configHash: `sha256:${sha}`,
            contentHash: `sha256:${"f".repeat(64)}`,
            validatedAt: new Date("2026-08-12T10:00:00.000Z"),
          }),
          create: jest.fn(),
        },
      } as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.registerValidatedRetrievalIndex({
        legalSourceVersionId: "source-1",
        version: "index-v1",
        configHash: `sha256:${sha}`,
        contentHash: `sha256:${"e".repeat(64)}`,
        validationManifestRef: "manifest:original",
        correlationId: "red-test",
      }),
    ).rejects.toMatchObject({ response: { problem: { status: 409 } } });
    // Why: The same indexed bytes under different retrieval settings are a different artifact.
    // How: Keep the content hash while changing only the config hash.
    // Invariant: A version replay cannot certify a configuration it never indexed.
    await expect(
      service.registerValidatedRetrievalIndex({
        legalSourceVersionId: "source-1",
        version: "index-v1",
        configHash: `sha256:${"a".repeat(64)}`,
        contentHash: `sha256:${"f".repeat(64)}`,
        validationManifestRef: "manifest:original",
        correlationId: "red-test",
      }),
    ).rejects.toMatchObject({ response: { problem: { status: 409 } } });
    // Why: The same version key must still be replayable for identical validated bytes.
    // How: Repeat with the stored content hash and manifest.
    // Invariant: Exact replay returns the original index without inserting another row.
    await expect(
      service.registerValidatedRetrievalIndex({
        legalSourceVersionId: "source-1",
        version: "index-v1",
        configHash: `sha256:${sha}`,
        contentHash: `sha256:${"f".repeat(64)}`,
        validationManifestRef: "manifest:original",
        correlationId: "red-test",
      }),
    ).resolves.toMatchObject({ id: "index-1" });
  });
});
