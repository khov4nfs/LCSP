import type { ComplianceRuleSetPacket } from "@lcsp/contracts/compliance-rule-set";
import { Injectable } from "@nestjs/common";
import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import {
  sourceClaimKey,
  type LegalSourceSnapshot,
} from "../../domain/compliance-rule-set-integrity.validator.js";

/** Reads the pinned legalSource facts the deterministic integrity validator checks a packet against. */
@Injectable()
export class LegalSourceSnapshotLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: LegalDocumentGraphService,
  ) {}

  async load(
    legalSourceVersionId: string,
    packet: ComplianceRuleSetPacket,
  ): Promise<{ snapshot: LegalSourceSnapshot; foreignHashes: Set<string> }> {
    const [documents, chunks, validIndex] = await Promise.all([
      this.prisma.legalSourceDocument.findMany({
        where: { legalSourceVersionId: legalSourceVersionId },
        select: { documentId: true, sourceEffectStatus: true },
      }),
      this.prisma.legalDocumentChunk.findMany({
        where: { legalSourceVersionId: legalSourceVersionId },
        select: {
          id: true,
          documentId: true,
          locator: true,
          contentSha256: true,
          legalStatus: true,
          legalEffectStatus: true,
          legalStatusSourceRef: true,
        },
      }),
      this.prisma.legalRetrievalIndex.findFirst({
        where: {
          legalSourceVersionId: legalSourceVersionId,
          status: "VALID",
          validatedAt: { not: null },
        },
        select: { id: true },
      }),
    ]);
    const effectByDocument = new Map(
      documents.map((d) => [d.documentId, d.sourceEffectStatus]),
    );

    // Only claims whose hash mismatches the pinned legalSource need a foreign-legalSource lookup.
    const pinnedHash = new Map(
      chunks.map((c) => [sourceClaimKey(c), c.contentSha256]),
    );
    const claims = [
      ...packet.legalRequirements.flatMap((rule) => rule.sourceRefs),
      ...packet.assessmentRules.flatMap((rule) => rule.sourceRefs),
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
          legalSourceVersionId: { not: legalSourceVersionId },
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
        documentGraph: await this.graph.export(legalSourceVersionId),
        legalSourceVersionId,
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
