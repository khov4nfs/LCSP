import { randomUUID } from "node:crypto";

import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import {
  ADMIN_SOURCE_CATALOG_IDS,
  ADMIN_SOURCE_DOCUMENT_TYPES,
  type AdminSourceCatalogId,
  type AdminSourceDocumentType,
} from "@lcsp/contracts/evidence";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { GetAdminSourceCatalogQuery } from "../../application/queries/get-admin-source-catalog/get-admin-source-catalog.query.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_KEYS = new Set([
  "catalog_id",
  "document_type",
  "document_number",
  "issuing_authority",
  "issue_date",
]);

const CATALOG_IDS = new Set<AdminSourceCatalogId>(
  Object.values(ADMIN_SOURCE_CATALOG_IDS),
);
const DOCUMENT_TYPES = new Set<AdminSourceDocumentType>(
  Object.values(ADMIN_SOURCE_DOCUMENT_TYPES),
);

@Controller("assessments")
export class AdminSourceCatalogController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(":assessmentId/admin-source-catalog")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.admin)
  async getAdminSourceCatalog(
    @Param("assessmentId") assessmentId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseInput(query, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new GetAdminSourceCatalogQuery(
          assessmentId,
          input,
          request.rbacContext.userId,
          correlationId,
        ),
      ),
    );
  }
}

function parseInput(query: Record<string, unknown>, correlationId: string) {
  if (Object.keys(query).some((key) => !ALLOWED_KEYS.has(key))) {
    invalidRequest(correlationId);
  }

  const catalogId = single(query.catalog_id);
  if (
    catalogId !== null &&
    !CATALOG_IDS.has(catalogId as AdminSourceCatalogId)
  ) {
    invalidRequest(correlationId);
  }

  const documentType = single(query.document_type);
  const documentNumber = single(query.document_number);
  const issuingAuthority = single(query.issuing_authority);
  const issueDate = single(query.issue_date);

  const hasAnyIdentityField =
    documentType !== null ||
    documentNumber !== null ||
    issuingAuthority !== null ||
    issueDate !== null;

  const hasCompleteIdentity =
    documentType !== null &&
    documentNumber !== null &&
    issuingAuthority !== null &&
    issueDate !== null;

  if (!catalogId && !hasAnyIdentityField) {
    invalidRequest(correlationId);
  }

  if (hasAnyIdentityField && !hasCompleteIdentity) {
    invalidRequest(correlationId);
  }

  if (
    documentType !== null &&
    (!DOCUMENT_TYPES.has(documentType as AdminSourceDocumentType) ||
      !DATE.test(issueDate!))
  ) {
    invalidRequest(correlationId);
  }

  return {
    ...(catalogId ? { catalogId: catalogId as AdminSourceCatalogId } : {}),
    ...(hasCompleteIdentity
      ? {
          documentIdentity: {
            documentType: documentType as AdminSourceDocumentType,
            documentNumber: documentNumber,
            issuingAuthority: issuingAuthority,
            issueDate: issueDate,
          },
        }
      : {}),
  };
}

function single(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
