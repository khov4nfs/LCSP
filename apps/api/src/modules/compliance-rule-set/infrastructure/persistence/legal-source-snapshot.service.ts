import { LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES } from "@lcsp/contracts/legal-source";
import type { ComplianceRuleSetPacket } from "@lcsp/contracts/compliance-rule-set";
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LegalDocumentGraphService } from "../../../legal-source/application/services/legal-document-graph.service.js";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { pinnedMaterializationId } from "./preparation-inventory.persistence.js";
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

  /**
   * Business purpose: Build the immutable source facts used to validate a Rule Set packet against its Preparation's pinned Legal Source.
   *
   * Business rules:
   * - The Preparation's source version, pinned structural materialization, retrieval-index validation, and chunk hashes define the validation snapshot.
   * - Reference-only document roles are retained so validators can prevent them from serving as operative claim evidence.
   * - Foreign-source lookup is limited to submitted citations whose locator exists in the pinned source but carries a different hash.
   *
   * Execution flow:
   * 1. Load source document roles/statuses, pinned chunks, and a validated retrieval-index marker concurrently.
   * 2. Identify stale submitted references and look up matching hashes in other source versions for explicit mixed-source diagnostics.
   * 3. Export the graph materialization pinned to this run and map persisted chunks into the deterministic validator snapshot.
   * 4. Return the snapshot together with known foreign hash identities.
   *
   * Failure cases:
   * - Missing source data, graph export errors, or persistence failures propagate instead of substituting a newer source snapshot.
   * - A missing pinned materialization is represented by the graph service's result and is rejected by the consuming validation gate.
   *
   * Side effects:
   * - None beyond database and graph reads; no source version or materialization is created or modified.
   */
  async load(
    run: {
      id: string;
      legalSourceVersionId: string;
      claimInventoryRevision?: number;
    },
    packet: ComplianceRuleSetPacket,
  ): Promise<{ snapshot: LegalSourceSnapshot; foreignHashes: Set<string> }> {
    const { legalSourceVersionId } = run;
    const [documents, chunks, validIndex] = await Promise.all([
      this.prisma.legalSourceDocument.findMany({
        where: { legalSourceVersionId: legalSourceVersionId },
        select: {
          documentId: true,
          sourceEffectStatus: true,
          corpusRole: true,
        },
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
        referenceOnlyDocumentIds: documents
          .filter(
            (d) =>
              d.corpusRole ===
              LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY,
          )
          .map((d) => d.documentId),
        documentGraph: await this.graph.export(
          legalSourceVersionId,
          await pinnedMaterializationId(this.prisma, run.id),
        ),
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

  /**
   * Business purpose: Validate selected-result publication against the exact source version without inventing a full-source review frontier.
   *
   * Business rules:
   * - Persisted document roles, validated index state, exact chunk locators/hashes, and legal-effect metadata define source authority.
   * - The snapshot omits the semantic graph because selected results have no frozen full-source graph frontier; source references still resolve against canonical chunks.
   *
   * Execution flow:
   * 1. Read source documents, chunks, and a validated retrieval-index marker through the caller's transaction.
   * 2. Identify submitted hash mismatches and look for matching hashes in other Legal Source Versions.
   * 3. Return the source facts used by the Rule Set integrity validator.
   *
   * Failure cases:
   * - Persistence errors propagate; missing or stale source facts remain validation failures and are never replaced with a newer source version.
   *
   * Side effects:
   * - Read-only transaction queries; no source, graph, Preparation, or review record is written.
   */
  async loadSelected(
    tx: Prisma.TransactionClient,
    legalSourceVersionId: string,
    packet: ComplianceRuleSetPacket,
  ): Promise<{ snapshot: LegalSourceSnapshot; foreignHashes: Set<string> }> {
    const [documents, chunks, validIndex] = await Promise.all([
      tx.legalSourceDocument.findMany({
        where: { legalSourceVersionId },
        select: {
          documentId: true,
          sourceEffectStatus: true,
          corpusRole: true,
        },
      }),
      tx.legalDocumentChunk.findMany({
        where: { legalSourceVersionId },
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
      tx.legalRetrievalIndex.findFirst({
        where: {
          legalSourceVersionId,
          status: "VALID",
          validatedAt: { not: null },
        },
        select: { id: true },
      }),
    ]);
    const effectByDocument = new Map(
      documents.map((document) => [
        document.documentId,
        document.sourceEffectStatus,
      ]),
    );
    const pinnedHash = new Map(
      chunks.map((chunk) => [sourceClaimKey(chunk), chunk.contentSha256]),
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
            (claim) =>
              pinnedHash.has(sourceClaimKey(claim)) &&
              pinnedHash.get(sourceClaimKey(claim)) !== claim.contentSha256,
          )
          .map(
            (claim) =>
              [
                `${sourceClaimKey(claim)}|${claim.contentSha256}`,
                claim,
              ] as const,
          ),
      ).values(),
    ];
    const foreignHashes = new Set<string>();
    if (stale.length) {
      const foreign = await tx.legalDocumentChunk.findMany({
        where: {
          legalSourceVersionId: { not: legalSourceVersionId },
          OR: stale.map((claim) => ({
            documentId: claim.documentId,
            locator: claim.locator,
            contentSha256: claim.contentSha256,
          })),
        },
        select: { documentId: true, locator: true, contentSha256: true },
      });
      for (const chunk of foreign)
        foreignHashes.add(`${sourceClaimKey(chunk)}|${chunk.contentSha256}`);
    }
    return {
      snapshot: {
        referenceOnlyDocumentIds: documents
          .filter(
            (document) =>
              document.corpusRole ===
              LEGAL_SOURCE_DOCUMENT_CORPUS_ROLES.REFERENCE_ONLY,
          )
          .map((document) => document.documentId),
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
