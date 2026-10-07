import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { LegalPortfolioService } from "../../application/services/legal-portfolio.service.js";

const LEGAL_PREPARATION_WORKER = "legal-preparation-worker";

/**
 * Worker-authenticated portfolio boundary: one start, one submit -> validate ->
 * activate, and the single runtime reader of the ACTIVE portfolio.
 */
@Controller("internal/legal-portfolio")
@UseGuards(WorkerApiKeyGuard)
export class LegalPortfolioController {
  constructor(private readonly portfolios: LegalPortfolioService) {}

  @Post("preparations")
  @HttpCode(202)
  async startPreparation(
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return resultEnvelope(
      await this.portfolios.startPreparation({
        body,
        requestedBy: LEGAL_PREPARATION_WORKER,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("claims")
  @HttpCode(200)
  async claim(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return resultEnvelope(
      await this.portfolios.claimPreparation({
        body,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("failures")
  @HttpCode(200)
  async fail(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return resultEnvelope(
      await this.portfolios.failPreparation({
        body,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("validations")
  @HttpCode(200)
  async validate(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return resultEnvelope(
      await this.portfolios.validate({
        body,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Post("submissions")
  @HttpCode(200)
  async submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return resultEnvelope(
      await this.portfolios.submit({
        body,
        actorId: LEGAL_PREPARATION_WORKER,
        correlationId: req.correlationId || randomUUID(),
      }),
    );
  }

  @Get("active")
  async active(@Req() req: AuthenticatedRequest) {
    return resultEnvelope(
      await this.portfolios.getActivePortfolio(
        req.correlationId || randomUUID(),
      ),
    );
  }
}
