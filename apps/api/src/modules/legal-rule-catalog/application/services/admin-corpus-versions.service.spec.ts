import { describe, expect, it, jest } from "@jest/globals";
import { CORPUS_VERSION_READINESS_STATES } from "@lcsp/contracts/legal-rule-catalog";

import { AdminCorpusVersionsService } from "./admin-corpus-versions.service.js";

describe("AdminCorpusVersionsService", () => {
  it("does not infer publication readiness from persisted documents or change sets", async () => {
    const findUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      id: "corpus-1",
      version: "v2026.09.02-draft",
      status: "DRAFT",
      sourceManifest: {
        changeSet: {
          addedDocumentIds: ["document-1"],
        },
      },
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
      approvedAt: null,
      documents: [{ chunks: [{ id: "chunk-1" }] }],
      retrievalIndexes: [
        {
          status: "VALID",
          validatedAt: new Date("2026-09-02T01:00:00.000Z"),
          validationManifestRef: "retrieval-validation:index-1",
        },
      ],
    });
    const service = new AdminCorpusVersionsService(
      { legalCorpusVersion: { findUnique } } as never,
      {} as never,
    );

    const detail = await service.detail("corpus-1");

    expect(detail.readiness).toBe(CORPUS_VERSION_READINESS_STATES.unavailable);
    expect(
      detail.readinessItems.every(
        (item) => item.state === CORPUS_VERSION_READINESS_STATES.unavailable,
      ),
    ).toBe(true);
    expect(
      detail.snapshot.every(
        (row) => row.validation === CORPUS_VERSION_READINESS_STATES.unavailable,
      ),
    ).toBe(true);
    expect(detail.actions.canPublish).toBe(false);
    expect(detail.actions.canDiscard).toBe(true);
  });
});
