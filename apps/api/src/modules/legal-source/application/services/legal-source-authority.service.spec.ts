import { describe, expect, it, jest } from "@jest/globals";
import { LEGAL_SOURCE_ERROR_CODES } from "@lcsp/contracts/legal-source";
import type { Prisma } from "@prisma/client";
import { OFFICIAL_LEGAL_CORPUS } from "../../domain/official-legal-authority.js";
import { LegalSourceAuthorityService } from "./legal-source-authority.service.js";

const sourceVersionId = "source-version";
const original = OFFICIAL_LEGAL_CORPUS[0];
const validDocument = {
  documentId: "official",
  sourceUrl: original.sourcePage,
  sourceSha256: `sha256:${original.sha256}`,
  blobSha256: original.sha256,
};

function fixture(documents: unknown[]) {
  const findMany = jest
    .fn<(query: unknown) => Promise<unknown[]>>()
    .mockResolvedValue(documents);
  const tx = {
    legalSourceDocument: { findMany },
  } as unknown as Prisma.TransactionClient;
  return { tx, findMany, subject: new LegalSourceAuthorityService() };
}

describe("new legal-source authority", () => {
  it("admits the configured original, including a historical upload of the same bytes", async () => {
    const { subject, tx, findMany } = fixture([
      validDocument,
      {
        ...validDocument,
        documentId: "original-upload",
        sourceUrl: "upload:original",
      },
    ]);
    await expect(
      subject.requireVersion(tx, sourceVersionId, "cid"),
    ).resolves.toBeUndefined();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { legalSourceVersionId: sourceVersionId },
      }),
    );
  });

  it.each([
    { documents: [] },
    { documents: [{ ...validDocument, blobSha256: null }] },
    { documents: [{ ...validDocument, blobSha256: "f".repeat(64) }] },
    {
      documents: [
        { ...validDocument, sourceSha256: "sha256:" + "f".repeat(64) },
      ],
    },
    {
      documents: [
        { ...validDocument, sourceUrl: OFFICIAL_LEGAL_CORPUS[1].sourcePage },
      ],
    },
    {
      documents: [
        validDocument,
        {
          documentId: "foreign",
          sourceUrl: "https://example.invalid/foreign",
          sourceSha256: "sha256:" + "f".repeat(64),
          blobSha256: "f".repeat(64),
        },
      ],
    },
  ])(
    "rejects missing, unpinned, substituted or mixed authority: %#",
    async ({ documents }) => {
      const { subject, tx } = fixture(documents);
      await expect(
        subject.requireVersion(tx, sourceVersionId, "cid"),
      ).rejects.toMatchObject({
        response: {
          problem: {
            code: LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
            status: 422,
          },
        },
      });
    },
  );
});
