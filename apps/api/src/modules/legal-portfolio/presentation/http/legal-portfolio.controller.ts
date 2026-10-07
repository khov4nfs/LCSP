import { randomUUID } from "node:crypto";

import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  type LegalPortfolioSubmitRequest,
  type LegalPortfolioValidateRequest,
  type LegalPreparationClaimRequest,
  type LegalPreparationFailRequest,
  type LegalPreparationStartRequest,
  legalPortfolioSubmitRequestSchema,
  legalPortfolioValidateRequestSchema,
  legalPreparationClaimRequestSchema,
  legalPreparationFailRequestSchema,
  legalPreparationStartRequestSchema,
} from "@lcsp/contracts/legal-portfolio";
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
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { ClaimLegalPreparationCommand } from "../../application/commands/claim-legal-preparation/claim-legal-preparation.command.js";
import { FailLegalPreparationCommand } from "../../application/commands/fail-legal-preparation/fail-legal-preparation.command.js";
import { StartLegalPreparationCommand } from "../../application/commands/start-legal-preparation/start-legal-preparation.command.js";
import { SubmitLegalPortfolioCommand } from "../../application/commands/submit-legal-portfolio/submit-legal-portfolio.command.js";
import { GetActiveLegalPortfolioQuery } from "../../application/queries/get-active-legal-portfolio/get-active-legal-portfolio.query.js";
import { ValidateLegalPortfolioQuery } from "../../application/queries/validate-legal-portfolio/validate-legal-portfolio.query.js";

const LEGAL_PREPARATION_WORKER = "legal-preparation-worker";
const body = (schema: z.ZodTypeAny, includeIssuePaths = false) =>
  new ZodValidationPipe(
    schema,
    LEGAL_PORTFOLIO_ERROR_CODES.submitRequestInvalid,
    HttpStatus.BAD_REQUEST,
    includeIssuePaths,
  );

/**
 * Worker-authenticated portfolio boundary: one start, one submit -> validate ->
 * activate, and the single runtime reader of the ACTIVE portfolio. Transport only: Zod
 * validates the body and each call is one Command/Query.
 */
@Controller("internal/legal-portfolio")
@UseGuards(WorkerApiKeyGuard)
export class LegalPortfolioController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  private correlation(req: AuthenticatedRequest): string {
    return req.correlationId || randomUUID();
  }

  @Post("preparations")
  @HttpCode(202)
  async startPreparation(
    @Body(body(legalPreparationStartRequestSchema))
    request: LegalPreparationStartRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new StartLegalPreparationCommand(
          request,
          LEGAL_PREPARATION_WORKER,
          this.correlation(req),
        ),
      ),
    );
  }

  @Post("claims")
  @HttpCode(200)
  async claim(
    @Body(body(legalPreparationClaimRequestSchema))
    request: LegalPreparationClaimRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ClaimLegalPreparationCommand(request, this.correlation(req)),
      ),
    );
  }

  @Post("failures")
  @HttpCode(200)
  async fail(
    @Body(body(legalPreparationFailRequestSchema))
    request: LegalPreparationFailRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new FailLegalPreparationCommand(request, this.correlation(req)),
      ),
    );
  }

  @Post("validations")
  @HttpCode(200)
  async validate(
    @Body(body(legalPortfolioValidateRequestSchema))
    request: LegalPortfolioValidateRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(
        new ValidateLegalPortfolioQuery(request, this.correlation(req)),
      ),
    );
  }

  @Post("submissions")
  @HttpCode(200)
  async submit(
    @Body(body(legalPortfolioSubmitRequestSchema, true))
    request: LegalPortfolioSubmitRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new SubmitLegalPortfolioCommand(
          request,
          LEGAL_PREPARATION_WORKER,
          this.correlation(req),
        ),
      ),
    );
  }

  @Get("active")
  async active(@Req() req: AuthenticatedRequest) {
    return resultEnvelope(
      await this.queryBus.execute(
        new GetActiveLegalPortfolioQuery(this.correlation(req)),
      ),
    );
  }
}
