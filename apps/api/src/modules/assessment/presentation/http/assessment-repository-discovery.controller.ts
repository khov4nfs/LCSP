import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  assessmentRootClaimSchema,
  repositoryDiscoveryRangePageQuerySchema,
  repositoryDiscoveryDetailPageQuerySchema,
  submitRepositoryDiscoverySchema,
  type RepositoryDiscoveryRangePageQuery,
  type RepositoryDiscoveryDetailPageQuery,
  type SubmitRepositoryDiscovery,
} from "@lcsp/contracts/assessment-domain";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { z } from "zod";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { AssessmentRepositoryDiscoveryService } from "../../application/services/assessment-repository-discovery.service.js";
import {
  ASSESSMENT_LEASE_HEADER,
  AssessmentLeaseGuard,
} from "./assessment-lease.guard.js";

const requestPipe = (schema: z.ZodTypeAny) =>
  new ZodValidationPipe(
    schema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/** Leased worker transport for immutable repository discovery input and bounded reads. */
@Controller("internal/assessment-runtime/:assessmentId/discovery")
@UseGuards(WorkerApiKeyGuard, AssessmentLeaseGuard)
export class AssessmentRepositoryDiscoveryController {
  constructor(
    private readonly discovery: AssessmentRepositoryDiscoveryService,
  ) {}

  private correlation(request: AuthenticatedRequest): string {
    return request.correlationId || randomUUID();
  }

  @Post()
  @HttpCode(200)
  async save(
    @Param(
      "assessmentId",
      requestPipe(assessmentRootClaimSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) leaseToken: string,
    @Body(requestPipe(submitRepositoryDiscoverySchema))
    body: SubmitRepositoryDiscovery,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.discovery.save({
        assessmentId,
        leaseToken,
        correlationId: this.correlation(request),
        discovery: body,
      }),
    );
  }

  @Get()
  async summary(
    @Param(
      "assessmentId",
      requestPipe(assessmentRootClaimSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) leaseToken: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.discovery.getSummary({
        assessmentId,
        leaseToken,
        correlationId: this.correlation(request),
      }),
    );
  }

  @Get("ranges")
  async ranges(
    @Param(
      "assessmentId",
      requestPipe(assessmentRootClaimSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) leaseToken: string,
    @Query(requestPipe(repositoryDiscoveryRangePageQuerySchema))
    query: RepositoryDiscoveryRangePageQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.discovery.getRangePage({
        assessmentId,
        leaseToken,
        correlationId: this.correlation(request),
        ...query,
      }),
    );
  }

  @Get("details")
  async details(
    @Param(
      "assessmentId",
      requestPipe(assessmentRootClaimSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) leaseToken: string,
    @Query(requestPipe(repositoryDiscoveryDetailPageQuerySchema))
    query: RepositoryDiscoveryDetailPageQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.discovery.getDetailPage({
        assessmentId,
        leaseToken,
        correlationId: this.correlation(request),
        ...query,
      }),
    );
  }
}
