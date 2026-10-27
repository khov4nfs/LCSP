import { randomUUID } from "node:crypto";

import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  type AcceptCaseFactRequest,
  type AcceptEvidenceRequest,
  type FinishAssessmentRootRequest,
  type RootActivityRequest,
  type StartRuleInvestigationRequest,
  type SubmitRuleDecisionRequest,
  type RequestAssessmentFinalization,
  type SubmitAssessmentFinalReportRequest,
  acceptCaseFactRequestSchema,
  acceptEvidenceRequestSchema,
  claimAssessmentRootRequestSchema,
  claimAssessmentRootExecutionRequestSchema,
  type ClaimAssessmentRootExecutionRequest,
  finishAssessmentRootRequestSchema,
  rootActivityRequestSchema,
  startRuleInvestigationRequestSchema,
  submitRuleDecisionRequestSchema,
  requestAssessmentFinalizationSchema,
  submitAssessmentFinalReportRequestSchema,
  openAssessmentHumanRequestSchema,
  type OpenAssessmentHumanRequest,
  reportUnresolvableHumanFactRequestSchema,
  type ReportUnresolvableHumanFactRequest,
  pinnedLegalSourceSearchRequestSchema,
  pinnedLegalSourceTextRequestSchema,
  getRuleDecisionQuerySchema,
  ruleDecisionRecordSchema,
  type GetRuleDecisionQueryParameters,
  type PinnedLegalSourceSearchRequest,
  type PinnedLegalSourceTextRequest,
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
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { z } from "zod";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { AcceptAssessmentEvidenceCommand } from "../../application/commands/accept-assessment-evidence/accept-assessment-evidence.command.js";
import { AcceptAssessmentFactCommand } from "../../application/commands/accept-assessment-fact/accept-assessment-fact.command.js";
import { ClaimAssessmentRootCommand } from "../../application/commands/claim-assessment-root/claim-assessment-root.command.js";
import { FinishAssessmentRootCommand } from "../../application/commands/finish-assessment-root/finish-assessment-root.command.js";
import { HeartbeatAssessmentRootCommand } from "../../application/commands/heartbeat-assessment-root/heartbeat-assessment-root.command.js";
import { OpenHumanRequestCommand } from "../../application/commands/open-human-request/open-human-request.command.js";
import { ReportUnresolvableHumanFactCommand } from "../../application/commands/report-unresolvable-human-fact/report-unresolvable-human-fact.command.js";
import { RecordRootActivityCommand } from "../../application/commands/record-root-activity/record-root-activity.command.js";
import { RequestAssessmentFinalizationCommand } from "../../application/commands/request-assessment-finalization/request-assessment-finalization.command.js";
import { StartRuleInvestigationCommand } from "../../application/commands/start-rule-investigation/start-rule-investigation.command.js";
import { SubmitRuleDecisionCommand } from "../../application/commands/submit-rule-decision/submit-rule-decision.command.js";
import { SubmitAssessmentFinalReportCommand } from "../../application/commands/submit-assessment-final-report/submit-assessment-final-report.command.js";
import { GetPinnedLegalSourceTextQuery } from "../../application/queries/get-pinned-legal-source-text/get-pinned-legal-source-text.query.js";
import { GetPinnedRuleSetQuery } from "../../application/queries/get-pinned-rule-set/get-pinned-rule-set.query.js";
import { SearchPinnedLegalSourceQuery } from "../../application/queries/search-pinned-legal-source/search-pinned-legal-source.query.js";
import { GetRootContextQuery } from "../../application/queries/get-root-context/get-root-context.query.js";
import { GetRootControlQuery } from "../../application/queries/get-root-control/get-root-control.query.js";
import { GetRuleDecisionQuery } from "../../application/queries/get-rule-decision/get-rule-decision.query.js";
import {
  ASSESSMENT_LEASE_HEADER,
  AssessmentLeaseGuard,
} from "./assessment-lease.guard.js";

const UNPROCESSABLE = HttpStatus.UNPROCESSABLE_ENTITY;
const requestPipe = (schema: z.ZodTypeAny, code: string) =>
  new ZodValidationPipe(schema, code, UNPROCESSABLE);
const bodyPipe = (schema: z.ZodTypeAny) =>
  requestPipe(schema, ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID);

/**
 * Worker-authenticated tool plane of the one Assessment Root run. Transport only: the lease
 * guard runs first, Zod validates the body, and each call is one Command/Query. Identity, thread
 * and execution are resolved from the server-issued lease by the handlers; nothing here accepts
 * an agent-supplied assessment/thread/execution/actor claim.
 */
@Controller("internal/assessment-runtime/:assessmentId")
@UseGuards(WorkerApiKeyGuard)
export class AssessmentDomainController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  private correlation(req: AuthenticatedRequest): string {
    return req.correlationId || randomUUID();
  }

  @Get("control")
  @UseGuards(AssessmentLeaseGuard)
  async control(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetRootControlQuery(assessmentId, lease, this.correlation(req)),
      ),
    );
  }

  @Post("claim")
  @HttpCode(200)
  async claim(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Body(bodyPipe(claimAssessmentRootExecutionRequestSchema))
    request: ClaimAssessmentRootExecutionRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ClaimAssessmentRootCommand(
          assessmentId,
          this.correlation(req),
          request?.runtimeRunId,
        ),
      ),
    );
  }

  @Post("heartbeat")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async heartbeat(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new HeartbeatAssessmentRootCommand(
          assessmentId,
          lease,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("finish")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async finish(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(finishAssessmentRootRequestSchema))
    body: FinishAssessmentRootRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new FinishAssessmentRootCommand(
          assessmentId,
          lease,
          body.state,
          this.correlation(req),
          body.checkpointId,
          body.requestIds,
          body.controlRequestId,
        ),
      ),
    );
  }

  @Get("context")
  @UseGuards(AssessmentLeaseGuard)
  async context(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Headers("x-lcsp-locale") localeHeader: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetRootContextQuery(
          assessmentId,
          lease,
          this.correlation(req),
          localeHeader,
        ),
      ),
    );
  }

  @Get("rule-set")
  @UseGuards(AssessmentLeaseGuard)
  async ruleSet(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetPinnedRuleSetQuery(assessmentId, lease, this.correlation(req)),
      ),
    );
  }

  /** One provision of the Legal Source Version the pinned rule set was prepared from. */
  @Get("legal-source/text")
  @UseGuards(AssessmentLeaseGuard)
  async legalSourceText(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Query(bodyPipe(pinnedLegalSourceTextRequestSchema))
    query: PinnedLegalSourceTextRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetPinnedLegalSourceTextQuery(
          assessmentId,
          lease,
          query.documentId,
          query.locator,
          this.correlation(req),
        ),
      ),
    );
  }

  /** Keyword search over that same pinned Legal Source Version. */
  @Get("legal-source/search")
  @UseGuards(AssessmentLeaseGuard)
  async legalSourceSearch(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Query(bodyPipe(pinnedLegalSourceSearchRequestSchema))
    query: PinnedLegalSourceSearchRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new SearchPinnedLegalSourceQuery(
          assessmentId,
          lease,
          query.query,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("evidence")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async evidence(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(acceptEvidenceRequestSchema)) body: AcceptEvidenceRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptAssessmentEvidenceCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("facts")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async facts(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(acceptCaseFactRequestSchema)) body: AcceptCaseFactRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptAssessmentFactCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("investigations")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async investigation(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(startRuleInvestigationRequestSchema))
    body: StartRuleInvestigationRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new StartRuleInvestigationCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("decisions")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async decisions(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(submitRuleDecisionRequestSchema))
    body: SubmitRuleDecisionRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new SubmitRuleDecisionCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Get("decisions/:assessmentRuleId")
  @UseGuards(AssessmentLeaseGuard)
  async getRuleDecision(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Param(
      "assessmentRuleId",
      bodyPipe(ruleDecisionRecordSchema.shape.assessmentRuleId),
    )
    assessmentRuleId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Query(
      requestPipe(
        getRuleDecisionQuerySchema,
        ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
      ),
    )
    lookup: GetRuleDecisionQueryParameters,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetRuleDecisionQuery(
          assessmentId,
          lease,
          assessmentRuleId,
          this.correlation(req),
          lookup.revision,
        ),
      ),
    );
  }

  @Post("human-requests")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async humanRequests(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(
      requestPipe(
        openAssessmentHumanRequestSchema,
        ASSESSMENT_DOMAIN_ERROR_CODES.HUMAN_REQUEST_INVALID,
      ),
    )
    body: OpenAssessmentHumanRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new OpenHumanRequestCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("human-fact-unresolvable")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async reportUnresolvableHumanFact(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(reportUnresolvableHumanFactRequestSchema))
    body: ReportUnresolvableHumanFactRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ReportUnresolvableHumanFactCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("finalization")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async requestFinalization(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(requestAssessmentFinalizationSchema))
    body: RequestAssessmentFinalization,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new RequestAssessmentFinalizationCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("final-report")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async finalReport(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(submitAssessmentFinalReportRequestSchema))
    body: SubmitAssessmentFinalReportRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new SubmitAssessmentFinalReportCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("activity")
  @UseGuards(AssessmentLeaseGuard)
  @HttpCode(200)
  async activity(
    @Param(
      "assessmentId",
      bodyPipe(claimAssessmentRootRequestSchema.shape.assessmentId),
    )
    assessmentId: string,
    @Headers(ASSESSMENT_LEASE_HEADER) lease: string,
    @Body(bodyPipe(rootActivityRequestSchema)) body: RootActivityRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new RecordRootActivityCommand(
          assessmentId,
          lease,
          body,
          this.correlation(req),
        ),
      ),
    );
  }
}
