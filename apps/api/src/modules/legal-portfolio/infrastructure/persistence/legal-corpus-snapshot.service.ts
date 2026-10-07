import type { LegalPortfolioPacket } from "@lcsp/contracts/legal-portfolio";
import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  sourceClaimKey,
  type CorpusSnapshot,
} from "../../domain/legal-portfolio-integrity.validator.js";

/** Reads the pinned corpus facts the deterministic integrity validator checks a packet against. */
@Injectable()
export class LegalCorpusSnapshotLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    corpusVersionId: string,
    packet: LegalPortfolioPacket,
  ): Promise<{ snapshot: CorpusSnapshot; foreignHashes: Set<string> }> {
    const [documents, chunks, validIndex] = await Promise.all([
      this.prisma.legalSourceDocument.findMany({
        where: { legalCorpusVersionId: corpusVersionId },
        select: { documentId: true, sourceEffectStatus: true },
      }),
      this.prisma.legalDocumentChunk.findMany({
        where: { legalCorpusVersionId: corpusVersionId },
        select: {
          id: true,
          documentId: true,
          locator: true,
          contentSha256: true,
          legalStatus: true,
        },
      }),
      this.prisma.legalRetrievalIndex.findFirst({
        where: {
          legalCorpusVersionId: corpusVersionId,
          status: "VALID",
          validatedAt: { not: null },
        },
        select: { id: true },
      }),
    ]);
    const effectByDocument = new Map(
      documents.map((d) => [d.documentId, d.sourceEffectStatus]),
    );

    // Only claims whose hash mismatches the pinned corpus need a foreign-corpus lookup.
    const pinnedHash = new Map(
      chunks.map((c) => [sourceClaimKey(c), c.contentSha256]),
    );
    const claims = [
      ...packet.legalRules.flatMap((rule) => rule.sourceRefs),
      ...packet.engineeringRules.flatMap((rule) => rule.sourceRefs),
      ...packet.contextRelations.flatMap((relation) =>
        relation.toSourceRef ? [relation.toSourceRef] : [],
      ),
    ];
    const stale = [
      ...new Map(
        claims
          .filter(
            (c) =>
              pinnedHash.has(sourceClaimKey(c)) &&
              pinnedHash.get(sourceClaimKey(c)) !== c.contentSha256,
          )
          .map((c) => [`${sourceClaimKey(c)}|${c.contentSha256}`, c] as const),
      ).values(),
    ];
    const foreignHashes = new Set<string>();
    if (stale.length > 0) {
      const foreign = await this.prisma.legalDocumentChunk.findMany({
        where: {
          legalCorpusVersionId: { not: corpusVersionId },
          OR: stale.map((c) => ({
            documentId: c.documentId,
            locator: c.locator,
            contentSha256: c.contentSha256,
          })),
        },
        select: { documentId: true, locator: true, contentSha256: true },
      });
      for (const c of foreign)
        foreignHashes.add(`${sourceClaimKey(c)}|${c.contentSha256}`);
    }
    return {
      snapshot: {
        corpusVersionId,
        retrievalIndexValid: validIndex !== null,
        chunks: chunks.map((chunk) => ({
          ...chunk,
          sourceEffectStatus:
            effectByDocument.get(chunk.documentId) ?? "UNKNOWN",
        })),
      },
      foreignHashes,
    };
  }
}
