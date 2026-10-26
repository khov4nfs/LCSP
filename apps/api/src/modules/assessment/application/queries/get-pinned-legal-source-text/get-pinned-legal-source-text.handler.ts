import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  pinnedLegalSourceTextSchema,
  type PinnedLegalSourceText,
} from "@lcsp/contracts/assessment-domain";
import { HttpStatus } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentCaseSupport } from "../../../infrastructure/persistence/assessment-case-support.service.js";
import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { GetPinnedLegalSourceTextQuery } from "./get-pinned-legal-source-text.query.js";

/**
 * One provision of the Legal Source Version the assessment's pinned rule set was prepared from.
 * The lookup is bound to that version, so the Root can neither read another legal source nor a newer
 * version of the same one; historical assessments keep reading exactly what they were assessed on.
 */
@QueryHandler(GetPinnedLegalSourceTextQuery)
export class GetPinnedLegalSourceTextHandler implements IQueryHandler<GetPinnedLegalSourceTextQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: AssessmentRuntimeAuthority,
    private readonly support: AssessmentCaseSupport,
  ) {}

  /**
   * Business purpose: Give the authorized Root the exact legal provision used to prepare this
   *   Assessment’s pinned Rule Set.
   *
   * Business rules:
   * - The execution lease is authorized before reading case pins; the lookup is restricted to
   *   the pinned Rule Set’s LegalSourceVersion, document and locator.
   * - Return immutable text, hash, hierarchy and recorded legal-effect metadata without
   *   interpreting applicability.
   *
   * Execution flow:
   * 1. Authorize the Root lease and load its case pins in a transaction.
   * 2. Resolve the pinned legal source and retrieve the exact document/locator.
   * 3. Validate and return the source-text projection with its provenance.
   *
   * Failure cases:
   * - An absent provision returns REQUEST_INVALID with LEGAL_SOURCE_PROVISION_NOT_FOUND and
   *   HTTP 404; invalid leases, missing pins and malformed projections propagate their existing
   *   errors.
   *
   * Side effects:
   * - Read-only database transaction; no source, decision or Assessment state is changed.
   */
  async execute(
    input: GetPinnedLegalSourceTextQuery,
  ): Promise<PinnedLegalSourceText> {
    return this.prisma.$transaction(async (tx) => {
      await this.authority.authorizeInTx(tx, {
        assessmentId: input.assessmentId,
        leaseToken: input.leaseToken,
        correlationId: input.correlationId,
        requireActive: false,
      });
      const pins = await this.support.loadPins(
        tx,
        input.assessmentId,
        input.correlationId,
      );
      const ruleSet = await tx.complianceRuleSetVersion.findUniqueOrThrow({
        where: { id: pins.ruleSetVersionId },
        select: { legalSourceVersionId: true },
      });
      const chunk = await tx.legalDocumentChunk.findUnique({
        where: {
          legalSourceVersionId_documentId_locator: {
            legalSourceVersionId: ruleSet.legalSourceVersionId,
            documentId: input.documentId,
            locator: input.locator,
          },
        },
        select: {
          documentId: true,
          locator: true,
          content: true,
          contentSha256: true,
          hierarchy: true,
          legalStatus: true,
          legalEffectStatus: true,
          legalStatusSourceRef: true,
          sourceDocument: {
            select: { title: true, sourceEffectStatus: true },
          },
        },
      });
      if (!chunk) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          {
            status: HttpStatus.NOT_FOUND,
            meta: { reason: "LEGAL_SOURCE_PROVISION_NOT_FOUND" },
          },
        );
      }
      return pinnedLegalSourceTextSchema.parse({
        documentId: chunk.documentId,
        documentTitle: chunk.sourceDocument.title,
        locator: chunk.locator,
        contentSha256: chunk.contentSha256,
        legalStatus: chunk.legalStatus,
        legalEffectStatus: chunk.legalEffectStatus,
        legalStatusSourceRef: chunk.legalStatusSourceRef,
        sourceEffectStatus: chunk.sourceDocument.sourceEffectStatus,
        hierarchy: chunk.hierarchy,
        content: chunk.content,
      });
    });
  }
}
