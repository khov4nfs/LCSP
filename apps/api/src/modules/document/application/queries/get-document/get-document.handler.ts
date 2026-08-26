import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
} from "@lcsp/contracts/document";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";

import {
  fromPrismaClassificationGuardrailStatus,
  fromPrismaDocumentRequestStatus,
  fromPrismaDocumentType,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { DocumentStorageService } from "../../../infrastructure/storage/document-storage.service.js";
import type { DocumentStatusDto } from "../../contracts/document/document-status.contract.js";
import { GetDocumentQuery } from "./get-document.query.js";

const DOWNLOAD_URL_TTL_MS = 5 * 60 * 1000;
const GENERIC_BLOCKED_REASON =
  "Document generation is blocked until the required review items are resolved.";

/**
 * Resolves one RBAC-filtered document status, hides restricted report types, and issues signed downloads for ready artifacts.
 */
@QueryHandler(GetDocumentQuery)
export class GetDocumentHandler implements IQueryHandler<GetDocumentQuery> {
  /**
   * Creates the handler with document/classification persistence and signed-download support.
   *
   * @param prisma - Prisma service used to retrieve document request and classification state.
   * @param storage - Service used to create short-lived signed download URLs.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorageService,
  ) {}

  /**
   * Applies full/redacted read semantics, retrieves one document request, and projects safe status/download metadata.
   *
   * @param query - Assessment/document identity, RBAC scope/action, and correlation context.
   * @returns Document status DTO with business-safe blocked reason and optional signed download.
   * @throws When the read action is unauthorized or the document is outside the caller's permitted scope.
   */
  async execute(query: GetDocumentQuery): Promise<DocumentStatusDto> {
    const allowRedactedRead = query.actorRole === AUTH_USER_ROLES.admin;
    const allowFullRead = query.actorRole === AUTH_USER_ROLES.customer;
    if (!allowFullRead && !allowRedactedRead) {
      this.forbidden(query.correlationId);
    }

    const documentRequest = await this.prisma.documentRequest.findFirst({
      where: {
        id: query.documentRequestId,
        assessmentId: query.assessmentId,
      },
      select: {
        id: true,
        assessmentId: true,
        classificationResultId: true,
        documentType: true,
        status: true,
        documentUrl: true,
        blockedReason: true,
        correlationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!documentRequest) this.notFound(query.correlationId);

    const documentType = fromPrismaDocumentType(documentRequest.documentType);
    if (allowRedactedRead && documentType === DOCUMENT_TYPES.finalReport) {
      this.notFound(query.correlationId);
    }

    const classification = await this.prisma.classificationResult.findUnique({
      where: { id: documentRequest.classificationResultId },
      select: { guardrailStatus: true },
    });

    const status = fromPrismaDocumentRequestStatus(documentRequest.status);
    const isReady = status === DOCUMENT_REQUEST_STATUSES.ready;
    const download = isReady
      ? this.buildDownload(
          documentRequest.assessmentId,
          documentRequest.id,
          documentRequest.documentUrl,
        )
      : null;

    return {
      document_request_id: documentRequest.id,
      document_type: documentType,
      status,
      blocked_reason:
        status === DOCUMENT_REQUEST_STATUSES.blocked
          ? this.toBusinessBlockedReason(documentRequest.blockedReason)
          : null,
      guardrail_status: classification
        ? fromPrismaClassificationGuardrailStatus(
            classification.guardrailStatus,
          )
        : null,
      download_url: download?.url ?? null,
      download_url_expires_at: download?.expiresAt ?? null,
      requested_at: documentRequest.createdAt.toISOString(),
      completed_at:
        isReady ||
        status === DOCUMENT_REQUEST_STATUSES.failed ||
        status === DOCUMENT_REQUEST_STATUSES.blocked
          ? documentRequest.updatedAt.toISOString()
          : null,
      correlationId: documentRequest.correlationId,
    };
  }

  /**
   * Creates a signed download URL when a ready document has a persisted artifact URL.
   *
   * @param assessmentId - Assessment bound into the signed token.
   * @param documentRequestId - Document request bound into the signed token.
   * @param documentUrl - Persisted backing artifact URL.
   * @returns Signed URL and expiration metadata, or null when no artifact URL exists.
   */
  private buildDownload(
    assessmentId: string,
    documentRequestId: string,
    documentUrl: string | null,
  ) {
    if (!documentUrl) {
      return null;
    }

    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_MS);
    return {
      url: this.storage.createSignedDownloadUrl({
        assessmentId,
        documentRequestId,
        documentUrl,
        expiresAt,
      }),
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Converts a worker blocked reason into business-safe text.
   *
   * @param reason - Persisted worker blocked reason.
   * @returns Safe business-facing blocked reason.
   */
  private toBusinessBlockedReason(reason: string | null): string {
    if (!reason || !reason.trim()) {
      return GENERIC_BLOCKED_REASON;
    }

    return this.looksTechnical(reason) ? GENERIC_BLOCKED_REASON : reason.trim();
  }

  /**
   * Detects implementation details that should be hidden from document consumers.
   *
   * @param reason - Raw blocked reason to inspect.
   * @returns True when the reason appears technical and should be replaced.
   */
  private looksTechnical(reason: string): boolean {
    return /(exception|stack|trace|\/|\\|\.ts\b|\.js\b|sql\b|timeout|503|500)/i.test(
      reason,
    );
  }

  /**
   * Throws a tenant/scope-safe document-not-found problem.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @throws Always throws the document-not-found problem.
   */
  private notFound(correlationId: string): never {
    throw problemException(
      DOCUMENT_ERROR_CODES.documentNotFound,
      correlationId,
      {
        status: HttpStatus.NOT_FOUND,
      },
    );
  }

  /**
   * Throws a standardized RBAC-denied problem for unsupported document read actions.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @throws Always throws the RBAC-denied problem.
   */
  private forbidden(correlationId: string): never {
    throw problemException(AUTH_ERROR_CODES.rbacDenied, correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }
}
