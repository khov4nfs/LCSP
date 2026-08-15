import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  DOCUMENT_ERROR_CODES,
  DOCUMENT_REQUEST_STATUSES,
  DOCUMENT_TYPES,
  type DocumentRequestStatus,
} from "@lcsp/contracts/document";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
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
 * Resolves one PBAC-filtered document status, hides restricted report types, and issues signed downloads for ready artifacts.
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
   * @param query - Assessment/document identity, tenant scope, PBAC scope/action, and correlation context.
   * @returns Document status DTO with business-safe blocked reason and optional signed download.
   * @throws When the read action is unauthorized or the document is outside the caller's permitted scope.
   */
  async execute(query: GetDocumentQuery): Promise<DocumentStatusDto> {
    const allowRedactedRead =
      query.selectedAction === PBAC_ACTIONS.documentReadRedacted;
    const allowFullRead = query.selectedAction === PBAC_ACTIONS.documentRead;
    if (!allowFullRead && !allowRedactedRead) {
      this.forbidden(query.correlationId);
    }

    if (allowRedactedRead && query.scope !== query.assessmentId) {
      this.notFound(query.correlationId);
    }

    const documentRequest = await this.prisma.documentRequest.findFirst({
      where: {
        id: query.documentRequestId,
        assessmentId: query.assessmentId,
        organizationId: query.organizationId,
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

    if (!documentRequest) {
      this.notFound(query.correlationId);
    }

    const documentType = fromPrismaDocumentType(documentRequest.documentType);
    const status = fromPrismaDocumentRequestStatus(documentRequest.status);

    const classification = await this.prisma.classificationResult.findUnique({
      where: { id: documentRequest.classificationResultId },
      select: { guardrailStatus: true },
    });

    if (allowRedactedRead && documentType === DOCUMENT_TYPES.finalReport) {
      this.forbidden(query.correlationId);
    }

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
          ? toBusinessBlockedReason(documentRequest.blockedReason)
          : null,
      guardrail_status: classification
        ? fromPrismaClassificationGuardrailStatus(
            classification.guardrailStatus,
          )
        : null,
      download_url: download?.url ?? null,
      download_url_expires_at: download?.expiresAt ?? null,
      requested_at: documentRequest.createdAt.toISOString(),
      completed_at: isCompletedStatus(status)
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
   * @returns Signed URL and expiration timestamp, or null when no artifact URL exists.
   */
  private buildDownload(
    assessmentId: string,
    documentRequestId: string,
    documentUrl: string | null,
  ): { url: string; expiresAt: string } | null {
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
   * Throws the tenant/scope-safe document-not-found problem.
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
   * Throws the standardized PBAC-denied problem for unauthorized document read modes.
   *
   * @param correlationId - Correlation identifier attached to the problem response.
   * @throws Always throws the PBAC-denied problem.
   */
  private forbidden(correlationId: string): never {
    throw problemException(AUTH_ERROR_CODES.pbacDenied, correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }
}

/**
 * Converts a worker blocked reason into business-safe text by hiding empty or technical implementation details.
 *
 * @param reason - Persisted worker blocked reason.
 * @returns Safe business-facing blocked reason.
 */
function toBusinessBlockedReason(reason: string | null): string {
  if (!reason || !reason.trim()) {
    return GENERIC_BLOCKED_REASON;
  }

  return looksTechnical(reason) ? GENERIC_BLOCKED_REASON : reason.trim();
}

/**
 * Detects stack traces, file paths, status codes, and other implementation details that should not reach document consumers.
 *
 * @param reason - Raw blocked reason to inspect.
 * @returns True when the reason appears technical and should be replaced.
 */
function looksTechnical(reason: string): boolean {
  return /(exception|stack|trace|\/|\\|\.ts\b|\.js\b|sql\b|timeout|503|500)/i.test(
    reason,
  );
}

/**
 * Determines whether a document request status represents a terminal state with a completion timestamp.
 *
 * @param status - Normalized document request status.
 * @returns True for ready, failed, and blocked statuses; false while queued or generating.
 */
function isCompletedStatus(status: DocumentRequestStatus): boolean {
  switch (status) {
    case DOCUMENT_REQUEST_STATUSES.ready:
    case DOCUMENT_REQUEST_STATUSES.failed:
    case DOCUMENT_REQUEST_STATUSES.blocked:
      return true;
    case DOCUMENT_REQUEST_STATUSES.queued:
    case DOCUMENT_REQUEST_STATUSES.generating:
      return false;
  }
}
