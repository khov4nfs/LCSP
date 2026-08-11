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
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { GetLegalCorpusReadinessQuery } from "../../application/queries/get-legal-corpus-readiness/get-legal-corpus-readiness.query.js";

const EFFECTIVE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CORPUS_REF = /^corpus_[A-Za-z0-9_-]{8,80}$/;
const ALLOWED_QUERY_KEYS = new Set([
  "effective_date",
  "pinned_corpus_version_id",
]);

@Controller("assessments")
export class LegalCorpusReadinessController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(":assessmentId/legal-corpus-readiness")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.legalCorpusRead)
  async getLegalCorpusReadiness(
    @Param("assessmentId") assessmentId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseReadinessInput(query, correlationId);
    return resultEnvelope(
      await this.queryBus.execute(
        new GetLegalCorpusReadinessQuery(
          assessmentId,
          request.pbacContext.organizationId,
          input.effectiveDate,
          input.pinnedCorpusVersionId,
          request.pbacContext.userId,
          request.pbacContext.policyId,
          request.pbacContext.policyVersion,
          correlationId,
        ),
      ),
    );
  }
}

function parseReadinessInput(
  query: Record<string, unknown>,
  correlationId: string,
): { effectiveDate: Date; pinnedCorpusVersionId: string | null } {
  if (Object.keys(query).some((key) => !ALLOWED_QUERY_KEYS.has(key))) {
    invalidRequest(correlationId);
  }
  const effectiveDateRaw = singleString(query.effective_date);
  if (!effectiveDateRaw || !EFFECTIVE_DATE.test(effectiveDateRaw)) {
    invalidRequest(correlationId);
  }
  const effectiveDate = new Date(`${effectiveDateRaw}T00:00:00.000Z`);
  if (
    Number.isNaN(effectiveDate.getTime()) ||
    effectiveDate.toISOString().slice(0, 10) !== effectiveDateRaw
  ) {
    invalidRequest(correlationId);
  }

  const pinnedCorpusVersionId = singleString(query.pinned_corpus_version_id);
  if (
    query.pinned_corpus_version_id !== undefined &&
    (!pinnedCorpusVersionId || !CORPUS_REF.test(pinnedCorpusVersionId))
  ) {
    invalidRequest(correlationId);
  }

  return {
    effectiveDate,
    pinnedCorpusVersionId: pinnedCorpusVersionId
      ? pinnedCorpusVersionId.slice("corpus_".length)
      : null,
  };
}

function singleString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function invalidRequest(correlationId: string): never {
  throw problemException(ASSESSMENT_ERROR_CODES.invalidRequest, correlationId, {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}
