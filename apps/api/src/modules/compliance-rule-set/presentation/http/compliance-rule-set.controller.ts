import { randomUUID } from "node:crypto";
import {
  claimInventoryOperationSchema,
  sourceReviewOperationSchema,
  claimDiscoveryDiagnosticRequestSchema,
  type SourceReviewOperation,
  type ClaimInventoryOperation,
} from "@lcsp/contracts/compliance-rule-set";
import {
  SourceReviewCommand,
  StartClaimDiscoveryDiagnosticCommand,
} from "../../application/commands/source-review/source-review.command.js";
import { ClaimInventoryCommand } from "../../application/commands/claim-inventory/claim-inventory.command.js";

import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  type ComplianceRuleSetSubmitRequest,
  type ComplianceRuleSetValidateRequest,
  type RuleSetPreparationClaimRequest,
  type RuleSetPreparationFailRequest,
  complianceRuleSetSubmitRequestSchema,
  complianceRuleSetValidateRequestSchema,
  ruleSetPreparationClaimRequestSchema,
  ruleSetPreparationFailRequestSchema,
} from "@lcsp/contracts/compliance-rule-set";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import type { z } from "zod";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { WorkerApiKeyGuard } from "../../../../common/guards/worker-api-key.guard.js";
import { ClaimRuleSetPreparationCommand } from "../../application/commands/claim-rule-set-preparation/claim-rule-set-preparation.command.js";
import { FailRuleSetPreparationCommand } from "../../application/commands/fail-rule-set-preparation/fail-rule-set-preparation.command.js";
import { SubmitComplianceRuleSetCommand } from "../../application/commands/submit-compliance-rule-set/submit-compliance-rule-set.command.js";
import { GetActiveComplianceRuleSetQuery } from "../../application/queries/get-active-compliance-rule-set/get-active-compliance-rule-set.query.js";
import { ValidateComplianceRuleSetCommand } from "../../application/commands/validate-compliance-rule-set/validate-compliance-rule-set.command.js";

const RULE_SET_PREPARATION_WORKER = "rule-set-preparation-worker";
const body = (schema: z.ZodTypeAny, includeIssuePaths = false) =>
  new ZodValidationPipe(
    schema,
    COMPLIANCE_RULE_SET_ERROR_CODES.submitRequestInvalid,
    HttpStatus.BAD_REQUEST,
    includeIssuePaths,
  );

/**
 * Worker-authenticated rule set boundary: claim, fail, validate, one submit -> activate, and the
 * single runtime reader of the ACTIVE rule set. Full Preparation is never started here: it is
 * started by Legal Source activation or the separate ADMIN action. Transport only: Zod validates the body and
 * each call is one Command/Query. Discovery-only sessions are disabled outside explicitly enabled isolated diagnostics.
 */
@Controller("internal/compliance-rule-set")
@UseGuards(WorkerApiKeyGuard)
export class ComplianceRuleSetController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  private correlation(req: AuthenticatedRequest): string {
    return req.correlationId || randomUUID();
  }

  @Post("source-reviews")
  @HttpCode(200)
  async sourceReview(
    @Body(body(sourceReviewOperationSchema, true))
    request: SourceReviewOperation,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new SourceReviewCommand(request, this.correlation(req)),
      ),
    );
  }

  @Post("discovery-diagnostics")
  @HttpCode(200)
  async discoveryDiagnostic(
    @Body(body(claimDiscoveryDiagnosticRequestSchema, true))
    request: z.infer<typeof claimDiscoveryDiagnosticRequestSchema>,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new StartClaimDiscoveryDiagnosticCommand(
          request.legalSourceVersionId,
          request.idempotencyKey,
        ),
      ),
    );
  }

  @Post("claim-inventories")
  @HttpCode(200)
  async inventory(
    @Body(body(claimInventoryOperationSchema, true))
    request: ClaimInventoryOperation,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ClaimInventoryCommand(request, this.correlation(req)),
      ),
    );
  }

  @Post("claims")
  @HttpCode(200)
  async claim(
    @Body(body(ruleSetPreparationClaimRequestSchema))
    request: RuleSetPreparationClaimRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ClaimRuleSetPreparationCommand(request, this.correlation(req)),
      ),
    );
  }

  @Post("failures")
  @HttpCode(200)
  async fail(
    @Body(body(ruleSetPreparationFailRequestSchema))
    request: RuleSetPreparationFailRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new FailRuleSetPreparationCommand(request, this.correlation(req)),
      ),
    );
  }

  @Post("validations")
  @HttpCode(200)
  async validate(
    @Body(body(complianceRuleSetValidateRequestSchema, true))
    request: ComplianceRuleSetValidateRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ValidateComplianceRuleSetCommand(request, this.correlation(req)),
      ),
    );
  }

  @Post("submissions")
  @HttpCode(200)
  async submit(
    @Body(body(complianceRuleSetSubmitRequestSchema, true))
    request: ComplianceRuleSetSubmitRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new SubmitComplianceRuleSetCommand(
          request,
          RULE_SET_PREPARATION_WORKER,
          this.correlation(req),
        ),
      ),
    );
  }

  @Get("active")
  async active(@Req() req: AuthenticatedRequest) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetActiveComplianceRuleSetQuery(this.correlation(req)),
      ),
    );
  }
}
