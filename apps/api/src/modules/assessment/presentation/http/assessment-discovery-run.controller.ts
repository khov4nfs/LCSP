import { randomUUID } from "node:crypto";

import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  completeAssessmentDiscoveryRunSchema,
  rejectAssessmentDiscoveryRunSchema,
  startAssessmentDiscoveryRunSchema,
  repositoryDiscoveryDetailPageQuerySchema,
  type CompleteAssessmentDiscoveryRun,
  type RejectAssessmentDiscoveryRun,
  type StartAssessmentDiscoveryRun,
} from "@lcsp/contracts/assessment-domain";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";

import { WorkerApiKeyGuard } from "../../../../platform/rbac/guards/worker-api-key.guard.js";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { AssessmentDiscoveryRunService } from "../../application/services/assessment-discovery-run.service.js";

const parse = (schema: z.ZodType) =>
  new ZodValidationPipe(
    schema,
    ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

const uuid = () => parse(z.uuid());

/** Owner transport for an optional, explicitly requested pre-audit deterministic discovery. */
@Controller("assessments/:assessmentId/discovery-runs")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class AssessmentDiscoveryRunController {
  constructor(private readonly runs: AssessmentDiscoveryRunService) {}

  /**
   * Business purpose: Let the assessment owner initiate a pre-scope source discovery.
   * Business rules:
   * - RBAC, UUID and body validation precede the domain's owner/pin/idempotency checks.
   * Execution flow:
   * 1. Validate the request and forward owner identity to the durable run service.
   * Failure cases:
   * - Invalid identity, stale pins and active audit are rejected by the service.
   * Side effects:
   * - Delegates transactional run/outbox persistence without creating any RuleDecision.
   */
  @Post()
  @HttpCode(200)
  async start(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Body(parse(startAssessmentDiscoveryRunSchema))
    body: StartAssessmentDiscoveryRun,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.runs.start({
        assessmentId,
        ownerId: req.rbacContext.userId,
        correlationId: req.correlationId || randomUUID(),
        idempotencyKey: body.idempotencyKey,
      }),
    );
  }

  /**
   * Business purpose: Resume the newest authorized discovery status after a browser refresh.
   * Business rules:
   * - The API authenticates the owner and never exposes another customer's source metadata.
   * Execution flow:
   * 1. Validate assessment identity and load the newest pinned discovery run.
   * Failure cases:
   * - Missing or foreign assessments fail closed; no run is an explicit empty state.
   * Side effects:
   * - Read-only owner projection.
   */
  @Get("latest")
  async latest(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.runs.latest({
        assessmentId,
        ownerId: req.rbacContext.userId,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  /**
   * Business purpose: Show all rule recommendations in bounded pages without exposing raw code.
   * Business rules:
   * - The API verifies owner, completed run and exact pinned artifact before returning any page.
   * Execution flow:
   * 1. Validate IDs, page collection/offset and fetch the corresponding immutable discovery page.
   * Failure cases:
   * - Foreign, invalid or unfinished runs are rejected without fabricated candidates.
   * Side effects:
   * - Read-only owner projection, no audit authorization.
   */
  @Get(":runId/details")
  async details(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Query(
      parse(repositoryDiscoveryDetailPageQuerySchema.omit({ recordId: true })),
    )
    query: Omit<
      z.infer<typeof repositoryDiscoveryDetailPageQuerySchema>,
      "recordId"
    >,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.runs.details({
        assessmentId,
        runId,
        ownerId: req.rbacContext.userId,
        correlationId: req.correlationId || randomUUID(),
        ...query,
      }),
    );
  }

  /**
   * Business purpose: Return an owner-only run status and verified bounded source recommendation preview.
   * Business rules:
   * - Only persisted completed discovery is exposed; missing data never implies no AI usage.
   * Execution flow:
   * 1. Validate both IDs and delegate owner/pin and artifact checks.
   * Failure cases:
   * - Foreign, stale, malformed or missing data rejects with the standard problem envelope.
   * Side effects:
   * - Read-only customer projection.
   */
  @Get(":runId")
  async get(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.runs.get({
        assessmentId,
        runId,
        ownerId: req.rbacContext.userId,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }
}

/** Worker transport for exact independent discovery-run leases, never Assessment Root leases. */
@Controller("internal/assessment-discovery/:assessmentId/runs/:runId")
@UseGuards(WorkerApiKeyGuard)
export class AssessmentDiscoveryRunWorkerController {
  constructor(private readonly runs: AssessmentDiscoveryRunService) {}

  @Post("claim")
  @HttpCode(200)
  async claim(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.runs.claim({
        assessmentId,
        runId,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("complete")
  @HttpCode(200)
  async complete(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Body(parse(completeAssessmentDiscoveryRunSchema))
    body: CompleteAssessmentDiscoveryRun,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.runs.complete({
        assessmentId,
        runId,
        correlationId: req.correlationId || randomUUID(),
        leaseToken: body.leaseToken,
        discovery: body.discovery,
      }),
    );
  }

  @Post("fail")
  @HttpCode(200)
  async fail(
    @Param("assessmentId", uuid()) assessmentId: string,
    @Param("runId", uuid()) runId: string,
    @Body(parse(rejectAssessmentDiscoveryRunSchema))
    body: RejectAssessmentDiscoveryRun,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.runs.fail({
        assessmentId,
        runId,
        correlationId: req.correlationId || randomUUID(),
        leaseToken: body.leaseToken,
        errorCode: body.errorCode,
      }),
    );
  }
}
